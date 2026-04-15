/**
 * Goose JSONL event file watcher.
 *
 * Watches a directory for `goose-events-*.jsonl` files and emits parsed
 * GooseEvent objects via a callback. Uses hybrid fs.watch + polling
 * (same strategy as the original pixel-agents extension for Claude JSONL).
 *
 * Designed to be used from Vite's configureServer or a standalone Express server.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { GooseEvent } from './gooseEvents.ts';

export interface GooseWatcherOptions {
  /** Directory to watch for goose-events-*.jsonl files */
  watchDir: string;
  /** Called for each parsed GooseEvent */
  onEvent: (event: GooseEvent, file: string) => void;
  /** Called when a new JSONL file is detected */
  onFileFound?: (file: string) => void;
  /** Polling interval in ms (fallback for unreliable fs.watch) */
  pollIntervalMs?: number;
}

interface WatchedFile {
  filePath: string;
  offset: number;
  lineBuffer: string;
}

const POLL_INTERVAL_DEFAULT = 1000;

export class GooseWatcher {
  private readonly watchDir: string;
  private readonly onEvent: GooseWatcherOptions['onEvent'];
  private readonly onFileFound: GooseWatcherOptions['onFileFound'];
  private readonly pollIntervalMs: number;

  private watchedFiles = new Map<string, WatchedFile>();
  private fsWatcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options: GooseWatcherOptions) {
    this.watchDir = options.watchDir;
    this.onEvent = options.onEvent;
    this.onFileFound = options.onFileFound;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_DEFAULT;
  }

  start(): void {
    // Ensure watch directory exists
    if (!fs.existsSync(this.watchDir)) {
      fs.mkdirSync(this.watchDir, { recursive: true });
    }

    // Scan for existing files — skip their content so we don't replay
    // stale sessions from before this server process started.
    this.scanForFiles(true);

    // fs.watch for new file detection
    try {
      this.fsWatcher = fs.watch(this.watchDir, (_eventType, filename) => {
        if (filename && this.isGooseEventFile(filename)) {
          const filePath = path.join(this.watchDir, filename);
          // New files appearing after startup are fresh sessions — read from beginning
          this.ensureWatching(filePath);
        }
        // Also read new lines on any change
        this.readAllFiles();
      });
    } catch {
      console.warn('[GooseWatcher] fs.watch failed, relying on polling only');
    }

    // Polling backup (Windows fs.watch can be unreliable)
    this.pollTimer = setInterval(() => {
      if (!this.disposed) {
        this.scanForFiles();
        this.readAllFiles();
      }
    }, this.pollIntervalMs);

    console.log(`[GooseWatcher] Watching ${this.watchDir} for goose-events-*.jsonl`);
  }

  stop(): void {
    this.disposed = true;
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.watchedFiles.clear();
  }

  /** Get list of currently watched JSONL files */
  getWatchedFiles(): string[] {
    return [...this.watchedFiles.keys()];
  }

  private isGooseEventFile(filename: string): boolean {
    return filename.startsWith('goose-events-') && filename.endsWith('.jsonl');
  }

  private scanForFiles(skipExisting = false): void {
    try {
      const files = fs.readdirSync(this.watchDir);
      for (const f of files) {
        if (this.isGooseEventFile(f)) {
          this.ensureWatching(path.join(this.watchDir, f), skipExisting);
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  private ensureWatching(filePath: string, skipExisting = false): void {
    if (this.watchedFiles.has(filePath)) return;

    // When skipExisting is true, seek to end-of-file so we only process
    // new events written after the server started.  This prevents replaying
    // stale sessions (e.g. after a crash where session_end was never written).
    let offset = 0;
    if (skipExisting) {
      try {
        offset = fs.statSync(filePath).size;
      } catch {
        // File may have disappeared between scan and stat — start from 0
      }
    }

    this.watchedFiles.set(filePath, {
      filePath,
      offset,
      lineBuffer: '',
    });

    this.onFileFound?.(filePath);
    console.log(`[GooseWatcher] Now watching: ${path.basename(filePath)}${skipExisting ? ' (skipped existing content)' : ''}`);

    // Only read existing content when not skipping
    if (!skipExisting) {
      this.readNewLines(filePath);
    }
  }

  private readAllFiles(): void {
    for (const filePath of this.watchedFiles.keys()) {
      this.readNewLines(filePath);
    }
  }

  private readNewLines(filePath: string): void {
    const state = this.watchedFiles.get(filePath);
    if (!state) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return; // File might have been deleted
    }

    // File was truncated/recreated — reset offset
    if (stat.size < state.offset) {
      state.offset = 0;
      state.lineBuffer = '';
    }

    if (stat.size === state.offset) return;

    console.log(`[GooseWatcher] Reading ${stat.size - state.offset}B from ${path.basename(filePath)}`);

    // Read new bytes
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      state.offset = stat.size;

      const text = state.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');

      // Last element is either '' (line ended with \n) or partial line
      state.lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as GooseEvent;
          if (event.type && event.ts) {
            this.onEvent(event, filePath);
          } else {
            console.warn(`[GooseWatcher] Skipping line — missing type/ts: ${trimmed.slice(0, 120)}`);
          }
        } catch {
          console.warn(`[GooseWatcher] Malformed line: ${trimmed.slice(0, 120)}`);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}
