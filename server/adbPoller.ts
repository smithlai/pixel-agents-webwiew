/**
 * Polls `adb devices -l` at a configurable interval and emits device list
 * changes via a callback.
 *
 * Gracefully handles missing ADB (logs once, stops polling).
 */

import * as child_process from 'child_process';

import type { AdbDevice, AdbDeviceStatus } from './deviceTypes.ts';
import { ADB_POLL_INTERVAL_MS } from './deviceTypes.ts';

export type DeviceListCallback = (devices: AdbDevice[]) => void;

export class AdbPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot = '';
  private adbMissing = false;

  constructor(
    private readonly onChange: DeviceListCallback,
    private readonly intervalMs: number = ADB_POLL_INTERVAL_MS,
  ) {}

  /** Start polling. Resolves after the first poll completes so callers
   *  can await device availability before accepting connections. */
  async start(): Promise<void> {
    await this.ensureAdbServer();
    await this.pollAsync();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Ensure the ADB daemon is running before the first poll.
   *  `adb devices` can implicitly start the server but may be too slow
   *  on the very first invocation (cold boot), causing a timeout.
   *  A dedicated `adb start-server` is more reliable. */
  private ensureAdbServer(): Promise<void> {
    return new Promise<void>((resolve) => {
      child_process.exec('adb start-server', { timeout: 15000 }, (err) => {
        if (err) {
          console.warn('[AdbPoller] adb start-server failed — ADB may not be installed');
        } else {
          console.log('[AdbPoller] ADB server ensured running');
        }
        resolve(); // Always resolve — poll will retry or mark missing
      });
    });
  }

  /** Promise-based first poll — ensures device list is populated before
   *  the WebSocket server starts accepting clients. */
  private pollAsync(): Promise<void> {
    if (this.adbMissing) return Promise.resolve();

    return new Promise<void>((resolve) => {
      child_process.exec('adb devices -l', { timeout: 5000 }, (err, stdout) => {
        if (err) {
          if (!this.adbMissing) {
            console.warn('[AdbPoller] adb not found or failed — polling disabled');
            this.adbMissing = true;
          }
          resolve();
          return;
        }
        if (stdout !== this.lastSnapshot) {
          this.lastSnapshot = stdout;
          this.onChange(AdbPoller.parse(stdout));
        }
        resolve();
      });
    });
  }

  private poll(): void {
    if (this.adbMissing) return;

    child_process.exec('adb devices -l', { timeout: 5000 }, (err, stdout) => {
      if (err) {
        if (!this.adbMissing) {
          console.warn('[AdbPoller] adb not found or failed — polling disabled');
          this.adbMissing = true;
        }
        return;
      }

      // Only fire callback when the raw output actually changes
      if (stdout === this.lastSnapshot) return;
      this.lastSnapshot = stdout;

      const devices = AdbPoller.parse(stdout);
      this.onChange(devices);
    });
  }

  /**
   * Parse `adb devices -l` output into AdbDevice[].
   *
   * Example lines:
   *   RFCR30XXXXX          device usb:1-1 product:xxx model:SM_G975F ...
   *   192.168.1.5:5555     device product:xxx model:Pixel_6_Pro ...
   *   RFCR30YYYYY          unauthorized usb:1-2 transport_id:3
   */
  static parse(output: string): AdbDevice[] {
    const devices: AdbDevice[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Skip header ("List of devices attached") and blanks
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('List of') || trimmed.startsWith('*')) {
        continue;
      }

      // Format: <serial> <tab> <status> [key:value ...]
      const match = trimmed.match(/^(\S+)\s+(device|unauthorized|offline)\b(.*)$/);
      if (!match) continue;

      const serial = match[1];
      const status = match[2] as AdbDeviceStatus;
      const rest = match[3];

      // Extract model from "model:XXX"
      const modelMatch = rest.match(/\bmodel:(\S+)/);
      const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : serial;

      // Extract transport_id from "transport_id:N"
      const tidMatch = rest.match(/\btransport_id:(\S+)/);
      const transportId = tidMatch ? tidMatch[1] : null;

      devices.push({ serial, model, status, transportId });
    }

    return devices;
  }
}
