/**
 * Types and constants for ADB device detection and dynamic Tester management.
 *
 * Shared by adbPoller, deviceManager, and viteGoosePlugin.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** First agent ID assigned to device-bound Testers (increments from here) */
export const DEVICE_AGENT_ID_START = 200;

/** ADB polling interval in milliseconds */
export const ADB_POLL_INTERVAL_MS = 5000;

/** Testrun ID prefix for device-spawned sessions.
 *
 * ⚠️  KEEP IN SYNC — this prefix is embedded in 3 places:
 *   1. HERE (source of truth)
 *   2. server/viteGoosePlugin.ts — JSONL filename regex `goose-events-dev-`
 *   3. server/heartbeatWatchdog.ts — glob prefix `sanitizeTestrun("dev-{serial}-")`
 * The value is passed to MobileGoose/tools/goose-log-wrapper.py via `--testrun`,
 * so the wrapper itself doesn't hard-code it.
 * If you change this value, update sites 2 and 3 in the same commit.
 */
export const TESTRUN_PREFIX = 'dev';

// ── ADB Device ───────────────────────────────────────────────────────────────

export type AdbDeviceStatus = 'device' | 'unauthorized' | 'offline';

/** A physical Android device detected via `adb devices -l` */
export interface AdbDevice {
  serial: string;
  model: string;
  status: AdbDeviceStatus;
  transportId: string | null;
}

// ── Device Agent ─────────────────────────────────────────────────────────────

export type DeviceAgentState = 'idle' | 'active' | 'error';

/** Active task running on a device */
export interface ActiveTask {
  command: string;
  serial: string;
  testrun: string;
  pid: number | null;
  startedAt: number;
  jsonlFile: string | null;
}

/** Server-side Tester bound 1:1 to an AdbDevice */
export interface DeviceAgent {
  serial: string;
  agentId: number;
  state: DeviceAgentState;
  idleSince: number;
  task: ActiveTask | null;
}

// ── WebSocket Messages ───────────────────────────────────────────────────────

/** Broadcast when ADB device list changes */
export interface DevicesUpdateMessage {
  type: 'devices-update';
  devices: Array<{
    serial: string;
    model: string;
    agentId: number;
    state: DeviceAgentState;
  }>;
}

/** Broadcast when Boss assigns a task to a Tester */
export interface TaskAssignedMessage {
  type: 'task-assigned';
  serial: string;
  agentId: number;
  command: string;
  testrun: string;
}

/** Broadcast when a task stops (completed, user-stop, or error) */
export interface TaskStoppedMessage {
  type: 'task-stopped';
  serial: string;
  agentId: number;
  reason: 'completed' | 'user-stop' | 'error';
}

/** All device-related WebSocket message types */
export type DeviceWebSocketMessage =
  | DevicesUpdateMessage
  | TaskAssignedMessage
  | TaskStoppedMessage;
