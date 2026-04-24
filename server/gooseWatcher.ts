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
import { StringDecoder } from 'string_decoder';

import type { GooseEvent } from './gooseEvents.ts';

export interface GooseWatcherOptions {
  /** Directory to watch for goose-events-*.jsonl files */
  watchDir: string;
  /** Called for each parsed GooseEvent */
  onEvent: (event: GooseEvent, file: string) => void;
  /** Called when a new JSONL file is detected */
  onFileFound?: (file: string) => void;
  /** Called when a watched JSONL file vanishes (deleted by external process) */
  onFileRemoved?: (file: string) => void;
  /** Polling interval in ms (fallback for unreliable fs.watch) */
  pollIntervalMs?: number;
  /**
   * MobileGoose test-reports directory. When the runtime JSONL vanishes,
   * the watcher will look up the archived copy at
   * `${archiveDir}/<testrun_safe>/goose-events-<testrun_safe>.jsonl`
   * and read any remaining bytes (including the terminal `session_end`)
   * before firing onFileRemoved. Skipped when unset.
   */
  archiveDir?: string;
}

interface WatchedFile {
  filePath: string;
  offset: number;
  lineBuffer: string;
  /** Stateful UTF-8 decoder — holds partial multi-byte chars across read boundaries
   *  so a CJK character split between two reads doesn't decode to U+FFFD. */
  decoder: StringDecoder;
}

const POLL_INTERVAL_DEFAULT = 1000;

export class GooseWatcher {
  private readonly watchDir: string;
  private readonly onEvent: GooseWatcherOptions['onEvent'];
  private readonly onFileFound: GooseWatcherOptions['onFileFound'];
  private readonly onFileRemoved: GooseWatcherOptions['onFileRemoved'];
  private readonly pollIntervalMs: number;
  private readonly archiveDir?: string;

  private watchedFiles = new Map<string, WatchedFile>();
  private fsWatcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options: GooseWatcherOptions) {
    this.watchDir = options.watchDir;
    this.onEvent = options.onEvent;
    this.onFileFound = options.onFileFound;
    this.onFileRemoved = options.onFileRemoved;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_DEFAULT;
    this.archiveDir = options.archiveDir;
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
      decoder: new StringDecoder('utf8'),
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

  /**
   * When the runtime JSONL disappears, try to drain remaining events from the
   * archived copy MobileGoose writes to `test-reports/<testrun>/<task>/` just
   * before `os.remove()`. This closes the TOCTOU gap between the final
   * `session_end` write and the cleanup without requiring the writer to sleep.
   *
   * JSONL may be in a task subdirectory (e.g. test-reports/<testrun>/STTL-xxx/).
   * Searches testrun root first, then task subdirectories.
   *
   * Returns true if the archive was found and drained (callers can rely on
   * session_end having been emitted via onEvent).
   */
  private findArchivePath(base: string): string | null {
    if (!this.archiveDir) return null;
    // Extract session_id_safe from filename: goose-events-<session_id_safe>.jsonl
    const m = base.match(/^goose-events-(.+)\.jsonl$/);
    if (!m) return null;

    // Search all testrun dirs → task subdirs for the matching JSONL archive.
    // Archive structure: test-reports/<testrun>/<task>/goose-events-<session_id_safe>.jsonl
    try {
      const testruns = fs.readdirSync(this.archiveDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const testrun of testruns) {
        const testrunDir = path.join(this.archiveDir, testrun);
        try {
          const taskDirs = fs.readdirSync(testrunDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
          for (const task of taskDirs) {
            const taskPath = path.join(testrunDir, task, base);
            try {
              fs.statSync(taskPath);
              return taskPath;
            } catch { /* not here */ }
          }
        } catch { /* skip */ }
      }
    } catch {
      return null;
    }
    return null;
  }

  private drainFromArchive(filePath: string, state: WatchedFile): boolean {
    if (!this.archiveDir) return false;
    const base = path.basename(filePath);

    const archivePath = this.findArchivePath(base);
    if (!archivePath) return false;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(archivePath);
    } catch {
      return false;
    }
    if (stat.size <= state.offset) return true; // archive already drained

    let fd: number;
    try {
      fd = fs.openSync(archivePath, 'r');
    } catch {
      return false;
    }
    try {
      const buf = Buffer.alloc(stat.size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      const text = state.lineBuffer + state.decoder.write(buf) + state.decoder.end();
      const lines = text.split('\n');
      // In archive-drain mode we consume everything; no partial line is carried.
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as GooseEvent;
          if (event.type && event.ts) {
            this.onEvent(event, filePath);
          }
        } catch {
          console.warn(`[GooseWatcher] Archive malformed line: ${trimmed.slice(0, 120)}`);
        }
      }
      console.log(`[GooseWatcher] Drained ${stat.size - state.offset}B from archive: ${archivePath}`);
      return true;
    } finally {
      fs.closeSync(fd);
    }
  }

  private handleVanished(filePath: string, reason: string): void {
    const state = this.watchedFiles.get(filePath);
    if (state) {
      const drained = this.drainFromArchive(filePath, state);
      if (drained) {
        console.log(`[GooseWatcher] File vanished (${reason}) — session_end recovered from archive: ${path.basename(filePath)}`);
      } else {
        console.warn(`[GooseWatcher] File vanished (${reason}), no archive available: ${path.basename(filePath)}`);
      }
    }
    this.watchedFiles.delete(filePath);
    this.onFileRemoved?.(filePath);
  }

  private readNewLines(filePath: string): void {
    const state = this.watchedFiles.get(filePath);
    if (!state) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      this.handleVanished(filePath, 'stat');
      return;
    }

    // File was truncated/recreated — reset offset
    if (stat.size < state.offset) {
      state.offset = 0;
      state.lineBuffer = '';
      // Rebuild decoder so any partial bytes held from the previous file
      // don't contaminate the start of the new content.
      state.decoder = new StringDecoder('utf8');
    }

    if (stat.size === state.offset) return;

    console.log(`[GooseWatcher] Reading ${stat.size - state.offset}B from ${path.basename(filePath)}`);

    // Read new bytes — file may be deleted between stat and open (TOCTOU race)
    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch {
      // File vanished (process cleanup, SessionCleaner, etc.)
      this.handleVanished(filePath, 'open');
      return;
    }
    try {
      const buf = Buffer.alloc(stat.size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      state.offset = stat.size;

      // Use stateful decoder instead of buf.toString('utf-8'):
      // if a multi-byte char (e.g. CJK, 3 bytes) is split across two reads,
      // toString would emit U+FFFD for each half, corrupting the line forever.
      // decoder.write() holds the trailing incomplete bytes internally and
      // prepends them to the next write, so the char is reassembled intact.
      const text = state.lineBuffer + state.decoder.write(buf);
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
