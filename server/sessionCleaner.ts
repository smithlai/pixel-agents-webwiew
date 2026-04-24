/**
 * Session file cleanup — maintains per-device quota to prevent disk bloat.
 *
 * Strategy: Per-Device Rotate
 * - Groups JSONL files by device serial
 * - Each device keeps last N sessions (configurable, default 10)
 * - Deletes older session files atomically
 * - Runs on startup + periodic (every 1 hour)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SessionCleanerOptions {
  /** Directory containing goose-events-*.jsonl files */
  watchDir: string;
  /** Keep this many sessions per device serial (default: 10) */
  maxSessionsPerDevice?: number;
  /** Cleanup interval in ms — 0 to disable periodic cleanup (default: 3600000 = 1 hour) */
  cleanupIntervalMs?: number;
}

interface SessionFile {
  path: string;
  serial: string;
  tsUuid: string; // uuid8 from filename
  createdMs: number; // file creation timestamp
}

export class SessionCleaner {
  private readonly watchDir: string;
  private readonly maxSessionsPerDevice: number;
  private readonly cleanupIntervalMs: number;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionCleanerOptions) {
    this.watchDir = options.watchDir;
    this.maxSessionsPerDevice = options.maxSessionsPerDevice ?? 10;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 3600000; // 1 hour
  }

  /**
   * Start periodic cleanup.
   * Also runs cleanup once immediately.
   */
  start(): void {
    // Initial cleanup
    this.cleanup();

    // Periodic cleanup (if enabled)
    if (this.cleanupIntervalMs > 0) {
      this.periodicTimer = setInterval(() => {
        this.cleanup();
      }, this.cleanupIntervalMs);
    }
  }

  /**
   * Stop periodic cleanup.
   */
  stop(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Run cleanup: scan directory, group by serial, delete excess sessions.
   */
  private cleanup(): void {
    try {
      if (!fs.existsSync(this.watchDir)) {
        console.log('[SessionCleaner] Watch directory does not exist, skipping cleanup');
        return;
      }

      // Scan for JSONL files
      const files = fs.readdirSync(this.watchDir);
      const sessions = this.parseSessionFiles(files);

      if (sessions.length === 0) {
        console.log('[SessionCleaner] No session files found');
        return;
      }

      // Group by serial
      const bySerial = new Map<string, SessionFile[]>();
      for (const session of sessions) {
        if (!bySerial.has(session.serial)) {
          bySerial.set(session.serial, []);
        }
        bySerial.get(session.serial)!.push(session);
      }

      // Process each serial — delete excess sessions (oldest first)
      let totalDeleted = 0;
      for (const [serial, deviceSessions] of bySerial) {
        // Sort by creation time (newest first)
        deviceSessions.sort((a, b) => b.createdMs - a.createdMs);

        const excess = deviceSessions.slice(this.maxSessionsPerDevice);
        for (const oldSession of excess) {
          try {
            fs.unlinkSync(oldSession.path);
            console.log(`[SessionCleaner] Deleted [${serial}] ${path.basename(oldSession.path)}`);
            totalDeleted++;
          } catch (err) {
            console.warn(`[SessionCleaner] Failed to delete ${oldSession.path}:`, err);
          }
        }
      }

      if (totalDeleted > 0) {
        console.log(`[SessionCleaner] Cleanup complete: ${totalDeleted} files deleted`);
      }
    } catch (err) {
      console.error('[SessionCleaner] Cleanup failed:', err);
    }
  }

  /**
   * Parse filenames and extract serial + creation time.
   */
  private parseSessionFiles(filenames: string[]): SessionFile[] {
    const sessions: SessionFile[] = [];

    for (const filename of filenames) {
      // goose-events-{SERIAL}-{uuid8}.jsonl
      const match = filename.match(/^goose-events-(.+)-([a-f0-9]{8})\.jsonl$/);
      if (!match) continue;

      const [, serial, uuid8] = match;
      const filePath = path.join(this.watchDir, filename);

      try {
        const stat = fs.statSync(filePath);
        sessions.push({
          path: filePath,
          serial,
          tsUuid: uuid8,
          createdMs: stat.birthtimeMs || stat.mtimeMs, // Use birthtime if available, fallback to mtime
        });
      } catch (err) {
        console.warn(`[SessionCleaner] Failed to stat ${filename}:`, err);
      }
    }

    return sessions;
  }
}
