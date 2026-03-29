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
import * as path from 'path';

import type { Plugin, ViteDevServer } from 'vite';

import { EventTranslator } from './eventTranslator.ts';
import { GooseWatcher } from './gooseWatcher.ts';

export interface GoosePluginOptions {
  /** Directory containing goose-events-*.jsonl files */
  watchDir: string;
  /** Agent ID for the Goose character in the webview (default: 103 = Tester) */
  agentId?: number;
  /** MobileGoose root directory — enables POST /goose/run to spawn test sessions */
  mobileGooseDir?: string;
}

export function goosePlugin(options: GoosePluginOptions): Plugin {
  const { watchDir, agentId = 103, mobileGooseDir } = options;

  let watcher: GooseWatcher | null = null;

  // ws types are imported dynamically to avoid resolution issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wss: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients = new Set<any>();
  const translator = new EventTranslator(agentId);

  // Buffer recent events so new WebSocket clients can catch up
  const recentEvents: string[] = [];
  const MAX_BUFFER = 200;

  function broadcast(messages: Array<Record<string, unknown>>): void {
    if (messages.length === 0) return;
    const payload = JSON.stringify({ type: 'goose-events', messages });
    for (const client of clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(payload);
      }
    }
  }

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

          // Send buffered events to new client
          if (recentEvents.length > 0) {
            wsClient.send(
              JSON.stringify({ type: 'goose-buffer', events: recentEvents }),
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
      watcher = new GooseWatcher({
        watchDir,
        onEvent: (event, _file) => {
          // Store raw event in buffer
          recentEvents.push(JSON.stringify(event));
          if (recentEvents.length > MAX_BUFFER) {
            recentEvents.splice(0, recentEvents.length - MAX_BUFFER);
          }

          // Translate to webview messages and broadcast
          const messages = translator.translate(event);
          broadcast(messages);
        },
        onFileFound: (file) => {
          console.log(`[GoosePlugin] Detected JSONL: ${file}`);
          // Reset translator state for new session file
          translator.reset();
        },
      });

      watcher.start();

      // ── REST endpoints ──────────────────────────────────────────────────
      const base = server.config.base.replace(/\/$/, '');

      server.middlewares.use(`${base}/goose/status`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            watching: watcher?.getWatchedFiles() ?? [],
            clients: clients.size,
            bufferedEvents: recentEvents.length,
          }),
        );
      });

      // POST /goose/run — spawn a MobileGoose session with the given command
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
            try {
              command = (JSON.parse(body) as { command?: string }).command?.trim() ?? '';
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

            console.log(`[GoosePlugin] Spawning MobileGoose: ${command}`);
            child_process.spawn('cmd', ['/c', batPath, 'run', command], {
              cwd: resolvedGooseDir,
              detached: true,
              stdio: 'ignore',
            }).unref();

            res.statusCode = 202;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, command }));
          });
        });

        console.log(`[GoosePlugin] /goose/run enabled — MobileGoose dir: ${resolvedGooseDir}`);
      }

      console.log(`[GoosePlugin] Ready — watching ${watchDir}`);
    },
  };
}
