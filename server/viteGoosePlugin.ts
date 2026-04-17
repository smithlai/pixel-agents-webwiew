/**
 * Vite plugin that integrates the Goose event watcher with WebSocket.
 *
 * In dev mode (`npm run dev`), this:
 * 1. Starts a GooseWatcher on the configured JSONL directory
 * 2. Upgrades HTTP connections on /goose-ws to WebSocket
 * 3. Forwards translated GooseEvents as webview messages to all connected clients
 * 4. Serves /goose/status as a health check endpoint
 * 5. Persists browser-mode UI state (layout, settings) via GET/POST /pixel-agents-web/state
 */

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type { Plugin, ViteDevServer } from 'vite';

import { findHighestDefaultLayout } from '../shared/assets/layoutDefaults.ts';
import { AdbPoller } from './adbPoller.ts';
import { DeviceManager } from './deviceManager.ts';
import { GooseWatcher } from './gooseWatcher.ts';
import { heartbeatFilename } from './heartbeatPaths.ts';
import { HeartbeatWatchdog } from './heartbeatWatchdog.ts';
import { SessionCleaner } from './sessionCleaner.ts';

// Project root = one level up from this file (server/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// State file: <project-root>/.runtime/pixel-agents-browser-workspace-state.json
const STATE_FILE = path.join(PROJECT_ROOT, '.runtime', 'pixel-agents-browser-workspace-state.json');
// Assets directory for default layout resolution
const ASSETS_DIR = path.join(PROJECT_ROOT, 'webview-ui', 'public', 'assets');
// Legacy path (written by older dev sessions that ran from webview-ui/)
const LEGACY_STATE_FILE = path.join(PROJECT_ROOT, 'webview-ui', '.runtime', 'pixel-agents-browser-workspace-state.json');

function readUiState(): Record<string, unknown> {
  // Primary path
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  // Legacy fallback — promote to primary on first read
  if (fs.existsSync(LEGACY_STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf8')) as Record<string, unknown>;
      console.log('[GoosePlugin] Migrating state from legacy path to project root');
      writeUiState(state);
      return state;
    } catch {
      return {};
    }
  }

  // Seed fallback: scan assets/ for highest-revision default layout.
  const found = findHighestDefaultLayout(ASSETS_DIR);
  if (found) {
    try {
      const layout = JSON.parse(fs.readFileSync(found.path, 'utf8')) as unknown;
      return { layout };
    } catch {
      return {};
    }
  }

  return {};
}

function writeUiState(state: Record<string, unknown>): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export interface GoosePluginOptions {
  /** Directory containing goose-events-*.jsonl files */
  watchDir: string;
  /** MobileGoose root directory — enables POST /goose/run to spawn test sessions */
  mobileGooseDir?: string;
}

export function goosePlugin(options: GoosePluginOptions): Plugin {
  const { watchDir, mobileGooseDir } = options;

  let watcher: GooseWatcher | null = null;
  let heartbeatWatchdog: HeartbeatWatchdog | null = null;
  let cleaner: SessionCleaner | null = null;
  const deviceManager = new DeviceManager();
  const adbPoller = new AdbPoller((devices) => {
    deviceManager.updateDevices(devices);
  });

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

    async configureServer(server: ViteDevServer) {
      // Dynamic import of ws — resolved at runtime from webview-ui/node_modules
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

          // Send current device list so already-connected devices appear immediately
          const agents = deviceManager.getAgents();
          if (agents.length > 0) {
            wsClient.send(
              JSON.stringify({
                type: 'devices-update',
                devices: agents.map(a => ({
                  serial: a.serial,
                  model: deviceManager.getModel(a.serial),
                  agentId: a.agentId,
                  state: a.state,
                })),
              }),
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

      // Archive fallback: MobileGoose wrapper copies session logs to
      // `${mobileGooseDir}/test-reports/<testrun_safe>/` before deleting the
      // runtime file. Letting the watcher drain from there closes the TOCTOU
      // gap on session_end without the writer having to sleep.
      const archiveDir = mobileGooseDir
        ? path.resolve(mobileGooseDir, 'test-reports')
        : undefined;

      watcher = new GooseWatcher({
        watchDir,
        archiveDir,
        onEvent: (event, file) => {
          const serial = fileSerialMap.get(file);
          if (!serial) {
            console.warn(`[GoosePlugin] Unmapped JSONL event dropped: ${path.basename(file)} (${event.type})`);
            return;
          }

          const translator = deviceManager.getTranslator(serial);
          if (!translator) {
            console.warn(`[GoosePlugin] Missing translator for serial ${serial}; event dropped (${event.type})`);
            return;
          }

          const messages = translator.translate(event);
          console.log(`[GoosePlugin] Event: ${event.type} → ${messages.length} messages (${clients.size} clients)${serial ? ` [${serial}]` : ''}`);
          broadcast(messages);

          // session_end 快路徑：Goose 自然結束時立即釋放本地 DeviceManager 快取，
          // 並通知前端 task-stopped，讓 DUT 角色的 isActive 正確歸零。
          // （DUT 的 agentStatus:'idle' 被 role !== 'dut' 保護跳過，
          //   只有 task-stopped 才會觸發 setAgentActive(false)。）
          // 外部 session（別的 server 派的工）不在這裡處理，由 heartbeat
          // watchdog 以檔案系統為真理自行收斂。
          if (serial && event.type === 'session_end') {
            const agent = deviceManager.getAgent(serial);
            const agentId = agent?.agentId;
            const completed = deviceManager.completeTask(serial, 'completed');
            if (completed) {
              console.log(`[GoosePlugin] Device ${serial} released (agent ${completed.agentId})`);
            }
            // 無論 completeTask 是否成功（可能已被 heartbeat watchdog 或 user-stop 搶先釋放），
            // 都必須 broadcast task-stopped，否則前端 DUT 的 isActive 永遠不會歸零。
            // 重複發送是安全的——前端 handler 是冪等的。
            if (agentId !== undefined) {
              broadcastRaw({
                type: 'task-stopped',
                serial,
                agentId,
                reason: 'completed',
              });
            }
          }
        },
        onFileFound: (file) => {
          console.log(`[GoosePlugin] Detected JSONL: ${file}`);

          // Extract serial from testrun in filename: goose-events-dev-{SERIAL}-{uuid8}.jsonl
          // ⚠️  KEEP IN SYNC with MobileGoose/tools/goose-log-wrapper.py (main(), jsonl_path assignment).
          // Filename produced by wrapper: `goose-events-{sanitize_testrun(testrun)}.jsonl`
          // where testrun = "dev-{serial}-{uuid8}" passed via --testrun argument.
          // 'dev' prefix = TESTRUN_PREFIX in deviceTypes.ts.
          // If the wrapper changes its naming convention, update this regex and TESTRUN_PREFIX
          // in the same cross-repo change.
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
            console.warn(`[GoosePlugin] Ignoring JSONL with unexpected filename: ${path.basename(file)}`);
          }
        },
        onFileRemoved: (file) => {
          // JSONL 被外部程序刪除（MobileGoose goose-log-wrapper.py 的 close() 在
          // emit session_end → archive → 立即 os.remove）。
          // 大多情況 session_end 已被 onEvent 處理，這裡作為安全網：
          // 若因 TOCTOU race 讀取失敗（stat 成功但 open 時已刪），session_end
          // 可能沒被收到。無條件執行 completeTask + task-stopped 是安全的（冪等）。
          const serial = fileSerialMap.get(file);
          if (!serial) {
            console.warn(`[GoosePlugin] File removed but unmapped: ${path.basename(file)}`);
            return;
          }
          console.log(`[GoosePlugin] File vanished, treating as session_end: ${path.basename(file)} [${serial}]`);

          const agent = deviceManager.getAgent(serial);
          const agentId = agent?.agentId;
          const completed = deviceManager.completeTask(serial, 'completed');
          if (completed) {
            console.log(`[GoosePlugin] Device ${serial} released via file-vanish (agent ${completed.agentId})`);
          }
          if (agentId !== undefined) {
            broadcastRaw({
              type: 'task-stopped',
              serial,
              agentId,
              reason: 'completed',
            });
          }
          fileSerialMap.delete(file);
        },
      });

      watcher.start();
      // Await first poll so device list is ready before any client connects
      await adbPoller.start();
      console.log('[GoosePlugin] ADB polling started');

      // Heartbeat watchdog — 以檔案系統為真理的收斂層。
      // 每 15s 掃 watchDir 的 .heartbeat 檔，對照 DeviceManager 狀態：
      //   active + 無活心跳 → 釋放（crash/kill-9/斷電）
      //   idle   + 有活心跳 → 標記外部 busy（別的 server / 手動 wrapper）
      heartbeatWatchdog = new HeartbeatWatchdog({
        watchDir,
        deviceManager,
        onRelease: (serial, agentId) => {
          broadcastRaw({
            type: 'task-stopped',
            serial,
            agentId,
            reason: 'error',
          });
        },
      });
      heartbeatWatchdog.start();
      console.log('[GoosePlugin] HeartbeatWatchdog started');

      // Session cleanup — maintains per-device quota (default: 10 sessions per device)
      cleaner = new SessionCleaner({
        watchDir,
        maxSessionsPerDevice: 10,
        cleanupIntervalMs: 3600000,
      });
      cleaner.start();
      console.log('[GoosePlugin] SessionCleaner started (max 10 sessions per device, cleanup every 1h)');

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

      // GET /pixel-agents-web/state — read persisted browser UI state
      // POST /pixel-agents-web/state — merge-patch persisted browser UI state
      server.middlewares.use(`${base}/pixel-agents-web/state`, (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(readUiState()));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const patch = JSON.parse(body) as Record<string, unknown>;
              const current = readUiState();
              const merged = { ...current, ...patch };
              writeUiState(merged);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
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

            // 派工前強制 reconcile：心跳檔是真理，先把快取對齊再下決策，
            // 避免外部 session 剛起來或剛 crash，快取還沒追上。
            heartbeatWatchdog?.tick();

            // Check specific device busy
            if (serial) {
              const target = deviceManager.getAgent(serial);
              if (target && target.state !== 'idle') {
                res.statusCode = 409;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'device_busy', message: `裝置 ${serial} 正在忙碌中` }));
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

            // Placeholder heartbeat：派工的瞬間先 touch 檔案，消除「assign
            // → spawn → wrapper 啟動」之間約 3~5 秒的真空期（其間 heartbeat
            // watchdog 會誤判死亡）。wrapper 啟動後會 touch 同一個檔名（都
            // 走 sanitize_testrun），自然接手更新。若 wrapper 從未啟動，
            // mtime 不再前進，watchdog 會在 STALE_THRESHOLD 後正確釋放。
            try {
              const hbPath = path.join(watchDir, heartbeatFilename(testrun));
              fs.mkdirSync(path.dirname(hbPath), { recursive: true });
              fs.writeFileSync(hbPath, `${Date.now()} (pixel-agents placeholder)`, 'utf8');
            } catch (err) {
              console.warn(`[GoosePlugin] Failed to write placeholder heartbeat for ${testrun}:`, err);
            }

            // Write command to a temp .cmd file to avoid quoting hell when
            // passing through Node → PowerShell → CMD → BAT → Python layers.
            // The .cmd self-deletes after execution.
            const tmpCmd = path.join(
              os.tmpdir(),
              `goose-run-${Date.now()}.cmd`,
            );
            // Do NOT embed the command string directly in the .cmd file:
            // CMD reads .cmd files using the system ANSI codepage (e.g. cp950/cp936),
            // so UTF-8 encoded Chinese characters would be corrupted.
            // Instead, pass the command through a PowerShell environment variable
            // ($env:GOOSE_TASK_COMMAND) — PowerShell uses Unicode internally and
            // child processes inherit the env var correctly.
            const script = [
              '@echo off',
              `cd /d "${resolvedGooseDir}"`,
              `set ANDROID_SERIAL=${assigned.serial}`,
              `call "${batPath}" run --testrun="${testrun}" -t "%GOOSE_TASK_COMMAND%"`,
              'del "%~f0"',
            ].join('\r\n');
            fs.writeFileSync(tmpCmd, script, 'utf8');

            // Use PowerShell Start-Process -WindowStyle Hidden so the entire
            // process tree (cmd + bat + python + goose) stays invisible.
            // -PassThru 讓 Start-Process 回傳 Process 物件，我們 pipe 出 Id 後
            // 在 Node 端 capture stdout → parse 成 cmd 的 PID → setTaskPid。
            // 之後 /goose/kill 可用 taskkill /T 連整棵子樹（bat/python/goose）一起收。
            const safeTmp = tmpCmd.replace(/'/g, "''");
            // Single-quoted PS strings are literal (only '' escapes ') — safe for Unicode
            const safeCmd = command.replace(/'/g, "''");
            const psCommand =
              `$env:GOOSE_TASK_COMMAND='${safeCmd}'; ` +
              `Start-Process -FilePath cmd` +
              ` -ArgumentList '/c','${safeTmp}'` +
              ` -WindowStyle Hidden` +
              ` -PassThru | Select-Object -ExpandProperty Id`;
            const ps = child_process.spawn('powershell', [
              '-NoProfile', '-NonInteractive', '-Command', psCommand,
            ], {
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            });
            let psStdout = '';
            let psStderr = '';
            ps.stdout?.on('data', (chunk: Buffer) => { psStdout += chunk.toString(); });
            ps.stderr?.on('data', (chunk: Buffer) => { psStderr += chunk.toString(); });
            ps.on('close', (code) => {
              // 注意：Start-Process 是 detached spawn，PowerShell 的 exit code
              // 只代表「我有沒有成功 fire-and-forget」，不代表 cmd/bat/goose
              // 是否還活著。所以這裡只記錄，不做釋放。真正的「啟動失敗」由
              // 下方的 spawn watchdog 透過「JSONL 是否出現」來判定。
              if (code !== 0 || psStderr) {
                console.error(
                  `[GoosePlugin] PowerShell exited with code ${code}` +
                  (psStderr ? `\n${psStderr}` : ''),
                );
              }
              // Parse spawned cmd PID from PowerShell stdout (-PassThru | Select Id)
              const pid = parseInt(psStdout.trim(), 10);
              if (Number.isFinite(pid) && pid > 0) {
                const agent = deviceManager.getAgent(assigned.serial);
                if (agent?.task?.testrun === testrun) {
                  deviceManager.setTaskPid(assigned.serial, pid);
                  console.log(`[GoosePlugin] Captured cmd PID ${pid} for testrun ${testrun}`);
                }
              } else {
                console.warn(`[GoosePlugin] Failed to parse spawned PID from stdout: "${psStdout.trim()}"`);
              }
            });
            ps.unref();

            // Spawn watchdog — 防卡死後援。
            // 若 60 秒內裝置仍綁定本次 testrun 且 GooseWatcher 從未偵測到
            // 對應的 JSONL（jsonlFile 仍為空），代表 Goose 整條啟動鏈
            // (PowerShell → cmd → bat → python → goose) 真的沒起來，安全釋放。
            // 一旦 JSONL 出現後，後續 session 生命週期由 session_start /
            // session_end 事件接管，與 spawn 無關。
            setTimeout(() => {
              const agent = deviceManager.getAgent(assigned.serial);
              if (agent?.task?.testrun === testrun && !agent.task.jsonlFile) {
                console.warn(
                  `[GoosePlugin] Spawn watchdog: no JSONL after 60s for ${assigned.serial} (testrun ${testrun}) — releasing device`,
                );
                deviceManager.completeTask(assigned.serial, 'spawn-timeout');
                broadcastRaw({
                  type: 'task-stopped',
                  serial: assigned.serial,
                  agentId: assigned.agentId,
                  reason: 'spawn-timeout',
                });
              }
            }, 60_000);

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

      // Cleanup on server close
      server.httpServer?.on('close', () => {
        console.log('[GoosePlugin] Server closing — stopping watchers...');
        watcher?.stop();
        heartbeatWatchdog?.stop();
        cleaner?.stop();
        adbPoller?.stop();
      });
    },
  };
}
