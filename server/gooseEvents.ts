/**
 * Goose Event types — mirrors goose-event-stream-spec.md
 *
 * These are the JSONL events produced by goose-log-wrapper.py.
 * The server watches the JSONL file and forwards parsed events to WebSocket clients.
 */

// ── Event type union ─────────────────────────────────────────────────────────

export type GooseEvent =
  | SessionStartEvent
  | ToolStartEvent
  | ToolArgsEvent
  | ToolEndEvent
  | DroidclawStartEvent
  | DroidclawStepEvent
  | DroidclawDoneEvent
  | DroidclawLogEvent
  | SessionEndEvent;

export interface SessionStartEvent {
  type: 'session_start';
  ts: string;
  provider: string;
  model: string;
  testrun: string;
}

export interface ToolStartEvent {
  type: 'tool_start';
  ts: string;
  toolId: string;
  toolName: string;
  extension: string;
}

export interface ToolArgsEvent {
  type: 'tool_args';
  ts: string;
  toolId: string;
  key: string;
  value: string;
}

export interface ToolEndEvent {
  type: 'tool_end';
  ts: string;
  toolId: string;
  toolName: string;
  extension: string;
  result?: { exitCode?: number; summary?: string };
}

export interface DroidclawStartEvent {
  type: 'droidclaw_start';
  ts: string;
  parentToolId: string;
  goal: string;
}

export interface DroidclawStepEvent {
  type: 'droidclaw_step';
  ts: string;
  parentToolId: string;
  step: number;
  maxSteps: number;
  think: string;
  decision: string;
}

export interface DroidclawDoneEvent {
  type: 'droidclaw_done';
  ts: string;
  parentToolId: string;
  success: boolean;
  message: string;
  totalSteps: number;
}

export interface DroidclawLogEvent {
  type: 'droidclaw_log';
  ts: string;
  path: string;
}

export interface SessionEndEvent {
  type: 'session_end';
  ts: string;
  reason: 'completed';
}
