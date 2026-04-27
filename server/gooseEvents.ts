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
  | DroidrunPlanEvent
  | DroidrunActionEvent
  | DroidrunResultEvent
  | DroidrunDetailEvent
  | DroidrunLogEvent
  | ReportInitEvent
  | ReportScreenshotEvent
  | ReportFinalizeEvent
  | TestVerdictEvent
  | SessionEndEvent;

export interface SessionStartEvent {
  type: 'session_start';
  ts: string;
  provider: string;
  model: string;
  testrun: string;
  schemaVersion?: number;
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

export interface DroidrunPlanEvent {
  type: 'droidrun_plan';
  ts: string;
  parentToolId: string;
  goal: string;
}

export interface DroidrunActionEvent {
  type: 'droidrun_action';
  ts: string;
  parentToolId: string;
  step: number;
  maxSteps: number;
  think: string;
  decision: string;
}

export interface DroidrunResultEvent {
  type: 'droidrun_result';
  ts: string;
  parentToolId: string;
  success: boolean;
  message: string;
  totalSteps: number;
}

export interface DroidrunDetailEvent {
  type: 'droidrun_detail';
  ts: string;
  parentToolId: string;
  goal: string;
  finalPackage?: string;
  finalActivity?: string;
  visitedPackages?: string[];
  agentNotes?: string;
  finalScreen?: string;
}

export interface DroidrunLogEvent {
  type: 'droidrun_log';
  ts: string;
  path: string;
}

export interface ReportInitEvent {
  type: 'report_init';
  ts: string;
  task: string;
  reportBase: string;
}

export interface ReportScreenshotEvent {
  type: 'report_screenshot';
  ts: string;
  label: string;
  path: string;
}

export interface ReportFinalizeEvent {
  type: 'report_finalize';
  ts: string;
}

export interface TestVerdictEvent {
  type: 'test_verdict';
  ts: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP';
  reason?: string;
}

export interface SessionEndEvent {
  type: 'session_end';
  ts: string;
  reason: 'completed';
}
