/**
 * Heartbeat watchdog — reconciles DeviceManager cache against the filesystem.
 *
 * Architecture:
 *   Filesystem (heartbeat files) is the source of truth.
 *   DeviceManager.state is a cache used for dispatch decisions and UI display.
 *   This watchdog polls the shared runtime directory every POLL_INTERVAL_MS
 *   and reconciles state in both directions:
 *
 *   - active agent, no fresh heartbeat  → release (Goose crashed / killed)
 *   - idle agent,   fresh heartbeat     → mark externally busy (another
 *                                           server or manual wrapper invocation)
 *
 * The filename convention is dictated by MobileGoose's goose-log-wrapper.py,
 * which writes `<sanitize(testrun)>.heartbeat`.  Our pixel-agents side also
 * writes a placeholder heartbeat at dispatch time using the exact same
 * sanitize rule (see heartbeatPaths.ts), so both producers target the same
 * file and mtime stays continuous across the wrapper takeover.
 *
 * Staleness threshold (STALE_MS) is set to 180 s to match the MobileGoose
 * orphan-cleanup window (goose-log-wrapper.py `STALE_THRESHOLD`); the 30 s
 * heartbeat interval gives 6 chances to register before we release.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { DeviceManager } from './deviceManager.ts';
import { TESTRUN_PREFIX } from './deviceTypes.ts';
import { sanitizeTestrun } from './heartbeatPaths.ts';

const POLL_INTERVAL_MS = 15_000;

// ⚠️  KEEP IN SYNC with MobileGoose/tools/goose-log-wrapper.py `STALE_THRESHOLD`.
// Both values must match — if MobileGoose changes its orphan-cleanup window,
// update this constant in the same cross-repo change (and vice versa).
const STALE_MS = 180_000;

const HEARTBEAT_SUFFIX = '.heartbeat';

export interface HeartbeatWatchdogOptions {
  watchDir: string;
  deviceManager: DeviceManager;
  /** Broadcast helper so UI learns about filesystem-driven releases */
  onRelease?: (serial: string, agentId: number) => void;
}

export class HeartbeatWatchdog {
  private readonly watchDir: string;
  private readonly deviceManager: DeviceManager;
  private readonly onRelease?: (serial: string, agentId: number) => void;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: HeartbeatWatchdogOptions) {
    this.watchDir = options.watchDir;
    this.deviceManager = options.deviceManager;
    this.onRelease = options.onRelease;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    // Run once immediately so a freshly started server reconciles without
    // waiting for the first interval.
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One reconciliation pass. Public for tests / manual kick. */
  tick(): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.watchDir);
    } catch {
      // Watch dir may not exist yet if MobileGoose never wrote anything.
      return;
    }

    const now = Date.now();

    // Build: serial → freshest heartbeat mtime (ms since epoch, or -Infinity
    // if no live heartbeat).  We use a prefix match against each agent's
    // sanitized testrun prefix because the filename format is
    // `<sanitize(dev-<serial>-<uuid8>)>.heartbeat`.
    const freshBySerial = new Map<string, number>();
    const agents = this.deviceManager.getAgents();
    const prefixes = agents.map((a) => ({
      serial: a.serial,
      prefix: sanitizeTestrun(`${TESTRUN_PREFIX}-${a.serial}-`),
    }));

    for (const entry of entries) {
      if (!entry.endsWith(HEARTBEAT_SUFFIX)) continue;
      const match = prefixes.find((p) => entry.startsWith(p.prefix));
      if (!match) continue;
      let mtime: number;
      try {
        mtime = fs.statSync(path.join(this.watchDir, entry)).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtime > STALE_MS) continue; // stale, treat as absent
      const existing = freshBySerial.get(match.serial) ?? -Infinity;
      if (mtime > existing) freshBySerial.set(match.serial, mtime);
    }

    // Reconcile each agent against filesystem truth.
    for (const agent of agents) {
      const hasLive = freshBySerial.has(agent.serial);
      const result = this.deviceManager.reconcileFromHeartbeat(
        agent.serial,
        hasLive,
      );
      if (result === 'released') {
        console.warn(
          `[HeartbeatWatchdog] ${agent.serial} released — no live heartbeat` +
          (agent.task ? ` (testrun ${agent.task.testrun})` : ' (external)'),
        );
        this.onRelease?.(agent.serial, agent.agentId);
      } else if (result === 'marked-busy') {
        console.log(
          `[HeartbeatWatchdog] ${agent.serial} marked externally busy (live heartbeat detected)`,
        );
      }
    }
  }
}
