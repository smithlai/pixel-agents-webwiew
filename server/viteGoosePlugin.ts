/**
 * Vite plugin that integrates the Goose event watcher with WebSocket.
 *
 * In dev mode (`npm run dev`), this:
 * 1. Starts a GooseWatcher on the configured JSONL directory
 * 2. Upgrades HTTP connections on /goose-ws to WebSocket
 * 3. Forwards translated GooseEvents as webview messages to all connected clients
 * 4. Serves /goose/status as a health check endpoint
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Plugin, ViteDevServer } from 'vite';

import { AdbPoller } from './adbPoller.ts';
import { DeviceManager } from './deviceManager.ts';
import { EventTranslator } from './eventTranslator.ts';
import { GooseWatcher } from './gooseWatcher.ts';

export interface GoosePluginOptions {
  /** Directory containing goose-events-*.jsonl files */
  watchDir: string;
  /** Agent ID for the fallback Goose character when no device is matched (default: 103 = Tester) */
  agentId?: number;
  /** MobileGoose root directory — enables POST /goose/run to spawn test sessions */
  mobileGooseDir?: string;
}

export function goosePlugin(options: GoosePluginOptions): Plugin {
  const { watchDir, agentId = 103, mobileGooseDir } = options;

  let watcher: GooseWatcher | null = null;
  const deviceManager = new DeviceManager();
  const adbPoller = new AdbPoller((devices) => {
    deviceManager.updateDevices(devices);
  });

  // Fallback translator for JSONL files that can't be matched to a device
  const fallbackTranslator = new EventTranslator(agentId);

  // ws types are imported dynamically to avoid resolution issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wss: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients = new Set<any>();

  // Buffer recent translated messages so new WebSocket clients can catch up
  const recentMessages: Array<Record<string, unknown>> = [];
  const MAX_BUFFER = 200;

  function broadcast(messages: Array<Record<string, unknown>>): void {
    if (messages.length === 0) return;
    // Buffer for late-joining clients
    for (const m of messages) {
      recentMessages.push(m);
    }
    if (recentMessages.length > MAX_BUFFER) {
      recentMessages.splice(0, recentMessages.length - MAX_BUFFER);
    }
    const payload = JSON.stringify({ type: 'goose-events', messages });
    for (const client of clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(payload);
      }
    }
  }

  /** Send an arbitrary JSON payload to all connected clients */
  function broadcastRaw(data: Record<string, unknown>): void {
    const payload = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  // Wire device changes → WebSocket broadcast
  deviceManager.onDeviceChange((agents) => {
    broadcastRaw({
      type: 'devices-update',
      devices: agents.map(a => ({
        serial: a.serial,
        model: deviceManager.getModel(a.serial),
        agentId: a.agentId,
        state: a.state,
      })),
    });
  });

  return {
    name: 'goose-events',

    configureServer(server: ViteDevServer) {
      // Dynamic import of ws — resolved at runtime from webview-ui/node_modules
      // @ts-expect-error dynamic import resolved at runtime by Vite/Node
      import('ws').then(({ WebSocketServer }: { WebSocketServer: new (opts: { noServer: boolean }) => import('ws').WebSocketServer }) => {
        // ── WebSocket server (shares the Vite HTTP server) ──────────────
        wss = new WebSocketServer({ noServer: true });

        server.httpServer?.on('upgrade', (request, socket, head) => {
          const url = new URL(
            request.url ?? '',
            `http://${request.headers.host ?? 'localhost'}`,
          );
          if (url.pathname === '/goose-ws') {
            wss.handleUpgrade(
              request,
              socket,
              head,
              (wsClient: unknown) => {
                wss.emit('connection', wsClient, request);
              },
            );
          }
          // Don't handle other upgrade requests — let Vite HMR handle them
        });

        wss.on('connection', (wsClient: { readyState: number; send: (data: string) => void; on: (event: string, cb: () => void) => void }) => {
          clients.add(wsClient);
          console.log(
            `[GoosePlugin] WebSocket client connected (${clients.size} total)`,
          );

          // Replay buffered (translated) messages to new client
          if (recentMessages.length > 0) {
            console.log(`[GoosePlugin] Replaying ${recentMessages.length} buffered messages to new client`);
            wsClient.send(
              JSON.stringify({ type: 'goose-events', messages: recentMessages }),
            );
          }

          wsClient.on('close', () => {
            clients.delete(wsClient);
            console.log(
              `[GoosePlugin] WebSocket client disconnected (${clients.size} total)`,
            );
          });
        });

        console.log(`[GoosePlugin] WebSocket server ready at /goose-ws`);
      }).catch((err: unknown) => {
        console.warn('[GoosePlugin] Failed to load ws module:', err);
      });

      // ── Goose event watcher ─────────────────────────────────────────────
      // Map JSONL filename → serial for routing events to the right translator
      const fileSerialMap = new Map<string, string>();

      watcher = new GooseWatcher({
        watchDir,
        onEvent: (event, file) => {
          // Try to route to the device-specific translator
          const serial = fileSerialMap.get(file);
          const translator = serial
            ? deviceManager.getTranslator(serial) ?? fallbackTranslator
            : fallbackTranslator;

          const messages = translator.translate(event);
          console.log(`[GoosePlugin] Event: ${event.type} → ${messages.length} messages (${clients.size} clients)${serial ? ` [${serial}]` : ''}`);
          broadcast(messages);
        },
        onFileFound: (file) => {
          console.log(`[GoosePlugin] Detected JSONL: ${file}`);

          // Extract serial from testrun in filename: goose-events-dev-{SERIAL}-{uuid8}.jsonl
          const match = path.basename(file).match(/^goose-events-dev-(.+)-[a-f0-9]{8}\.jsonl$/);
          if (match) {
            const serial = match[1];
            fileSerialMap.set(file, serial);
            deviceManager.setTaskJsonlFile(serial, file);
            // Reset the device-specific translator for this new session
            const tr = deviceManager.getTranslator(serial);
            tr?.reset();
            console.log(`[GoosePlugin] Mapped JSONL to device: ${serial}`);
          } else {
            // Fallback — no serial in filename
            fallbackTranslator.reset();
          }
        },
      });

      watcher.start();
      adbPoller.start();
      console.log('[GoosePlugin] ADB polling started');

      // ── REST endpoints ──────────────────────────────────────────────────
      const base = server.config.base.replace(/\/$/, '');

      server.middlewares.use(`${base}/goose/status`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            watching: watcher?.getWatchedFiles() ?? [],
            clients: clients.size,
            bufferedEvents: recentMessages.length,
          }),
        );
      });

      // GET /goose/devices — list ADB devices and their Tester state
      server.middlewares.use(`${base}/goose/devices`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const agents = deviceManager.getAgents();
        res.end(
          JSON.stringify({
            devices: agents.map(a => ({
              serial: a.serial,
              model: deviceManager.getModel(a.serial),
              agentId: a.agentId,
              state: a.state,
              idleSince: a.idleSince,
              task: a.task ? { command: a.task.command, testrun: a.task.testrun, startedAt: a.task.startedAt } : null,
            })),
          }),
        );
      });

      // POST /goose/run — assign task to idle Tester and spawn MobileGoose
      if (mobileGooseDir) {
        const resolvedGooseDir = path.resolve(process.cwd(), mobileGooseDir);
        const batPath = path.join(resolvedGooseDir, 'start-goose.bat');

        server.middlewares.use(`${base}/goose/run`, (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }

          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            let command = '';
            let serial: string | undefined;
            try {
              const parsed = JSON.parse(body) as { command?: string; serial?: string };
              command = parsed.command?.trim() ?? '';
              serial = parsed.serial?.trim() || undefined;
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
              return;
            }

            if (!command) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'command is required' }));
              return;
            }

            // Check if any devices exist
            const allAgents = deviceManager.getAgents();
            if (allAgents.length === 0) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'no_devices', message: '沒有偵測到 ADB 裝置' }));
              return;
            }

            // Check specific device busy
            if (serial) {
              const target = deviceManager.getAgent(serial);
              if (target && target.state !== 'idle') {
                res.statusCode = 409;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'device_busy', message: `裝置 ${serial} 正在執行任務` }));
                return;
              }
            }

            // Assign task
            const assignment = deviceManager.assignTask(command, serial);
            if (!assignment) {
              res.statusCode = 409;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'no_available_tester', message: '所有 Tester 都在忙碌中' }));
              return;
            }

            const { agent: assigned, testrun } = assignment;
            console.log(`[GoosePlugin] Spawning MobileGoose: ${command} → ${assigned.serial} (agent ${assigned.agentId}, testrun ${testrun})`);

            // Write command to a temp .cmd file to avoid quoting hell when
            // passing through Node → PowerShell → CMD → BAT → Python layers.
            // The .cmd self-deletes after execution.
            const tmpCmd = path.join(
              os.tmpdir(),
              `goose-run-${Date.now()}.cmd`,
            );
            const cmdEscaped = command.replace(/"/g, '""');
            const script = [
              '@echo off',
              `cd /d "${resolvedGooseDir}"`,
              `set ANDROID_SERIAL=${assigned.serial}`,
              `call "${batPath}" run --testrun="${testrun}" -t "${cmdEscaped}"`,
              'del "%~f0"',
            ].join('\r\n');
            fs.writeFileSync(tmpCmd, script, 'utf8');

            // Use PowerShell Start-Process -WindowStyle Hidden so the entire
            // process tree (cmd + bat + python + goose) stays invisible.
            const safeTmp = tmpCmd.replace(/'/g, "''");
            const psCommand =
              `Start-Process -FilePath cmd` +
              ` -ArgumentList '/c','${safeTmp}'` +
              ` -WindowStyle Hidden`;
            const ps = child_process.spawn('powershell', [
              '-NoProfile', '-NonInteractive', '-Command', psCommand,
            ], {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            });
            let psStderr = '';
            ps.stderr?.on('data', (chunk: Buffer) => { psStderr += chunk.toString(); });
            ps.on('close', (code) => {
              if (code !== 0 || psStderr) {
                console.error(
                  `[GoosePlugin] PowerShell exited with code ${code}` +
                  (psStderr ? `\n${psStderr}` : ''),
                );
              }
            });
            ps.unref();

            // Broadcast task-assigned to all clients
            broadcastRaw({
              type: 'task-assigned',
              serial: assigned.serial,
              agentId: assigned.agentId,
              command,
              testrun,
            });

            res.statusCode = 202;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              command,
              serial: assigned.serial,
              agentId: assigned.agentId,
              testrun,
            }));
          });
        });

        // POST /goose/kill — stop a running task by serial
        server.middlewares.use(`${base}/goose/kill`, (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }

          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            let serial = '';
            try {
              serial = (JSON.parse(body) as { serial?: string }).serial?.trim() ?? '';
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
              return;
            }

            const agent = deviceManager.getAgent(serial);
            if (!agent?.task) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'no_active_task' }));
              return;
            }

            // Kill process tree
            if (agent.task.pid) {
              child_process.spawn('taskkill', ['/T', '/F', '/PID', String(agent.task.pid)], {
                stdio: 'ignore',
                windowsHide: true,
              });
            }

            const completed = deviceManager.completeTask(serial, 'user-stop');
            broadcastRaw({
              type: 'task-stopped',
              serial,
              agentId: completed?.agentId ?? agent.agentId,
              reason: 'user-stop',
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          });
        });

        console.log(`[GoosePlugin] /goose/run enabled — MobileGoose dir: ${resolvedGooseDir}`);
      }

      console.log(`[GoosePlugin] Ready — watching ${watchDir}`);
    },
  };
}
