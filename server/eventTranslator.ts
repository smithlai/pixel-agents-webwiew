/**
 * Translates GooseEvent JSONL events into webview messages
 * that useExtensionMessages.ts already understands.
 *
 * Mapping (from goose-event-stream-spec.md):
 *   tool_start       → agentToolStart     (Goose sits down, typing/reading)
 *   tool_args        → agentToolStart     (update status text with args)
 *   tool_end         → agentToolDone      (animation switch)
 *   droidrun_plan    → agentToolStart     (with "Subtask:" prefix → spawns sub-agent)
 *   droidrun_action  → subagentToolStart  (sub-agent status text update)
 *   droidrun_result  → subagentClear      (sub-agent disappears)
 *   session_end      → agentStatus: idle  (Goose stands up, wanders)
 */

import type { GooseEvent } from './gooseEvents.ts';

/** A webview message ready to be dispatched via window.postMessage or WebSocket */
export interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Stateful translator that tracks active tools and DroidRun sub-tasks
 * for a single Goose agent.
 */
export class EventTranslator {
  private readonly agentId: number;

  /** Maps GooseEvent toolId → webview toolId (we reuse as-is) */
  private activeTools = new Set<string>();

  /** Maps parentToolId → DroidRun subtask tracking */
  private activeDroidruns = new Map<string, { goal: string; stepCount: number }>();

  /** Accumulated tool_args for current tool (toolId → status text) */
  private toolStatusText = new Map<string, string>();

  constructor(agentId: number) {
    this.agentId = agentId;
  }

  /** Translate a GooseEvent into zero or more webview messages */
  translate(event: GooseEvent): WebviewMessage[] {
    const messages: WebviewMessage[] = [];

    switch (event.type) {
      case 'session_start':
        // Activate the agent
        messages.push({
          type: 'agentStatus',
          id: this.agentId,
          status: 'active',
        });
        break;

      case 'tool_start': {
        this.activeTools.add(event.toolId);
        const status = this.buildToolStatus(event.toolName, event.extension);
        this.toolStatusText.set(event.toolId, status);
        messages.push({
          type: 'agentToolStart',
          id: this.agentId,
          toolId: event.toolId,
          status,
        });
        break;
      }

      case 'tool_args': {
        // Update the status text with args info
        const currentStatus = this.toolStatusText.get(event.toolId) ?? '';
        const updatedStatus = this.buildToolStatusWithArgs(currentStatus, event.key, event.value);
        this.toolStatusText.set(event.toolId, updatedStatus);

        // Send a new agentToolStart to update the overlay text
        // (agentToolStart with same toolId is idempotent in useExtensionMessages —
        //  it checks `list.some(t => t.toolId === toolId)` so won't duplicate.
        //  We need a different approach: send agentToolDone + agentToolStart to replace.)
        messages.push(
          { type: 'agentToolDone', id: this.agentId, toolId: event.toolId },
          { type: 'agentToolStart', id: this.agentId, toolId: event.toolId, status: updatedStatus },
        );
        break;
      }

      case 'tool_end': {
        this.activeTools.delete(event.toolId);
        this.toolStatusText.delete(event.toolId);
        messages.push({
          type: 'agentToolDone',
          id: this.agentId,
          toolId: event.toolId,
        });

        // If no more active tools, clear all and go idle briefly
        if (this.activeTools.size === 0) {
          messages.push({
            type: 'agentToolsClear',
            id: this.agentId,
          });
        }
        break;
      }

      case 'droidrun_plan': {
        this.activeDroidruns.set(event.parentToolId, {
          goal: event.goal,
          stepCount: 0,
        });
        // Spawn sub-agent via "Subtask:" prefix convention
        messages.push({
          type: 'agentToolStart',
          id: this.agentId,
          toolId: `dr-${event.parentToolId}`,
          status: `Subtask: DroidRun — ${event.goal}`,
        });
        break;
      }

      case 'droidrun_action': {
        const dr = this.activeDroidruns.get(event.parentToolId);
        if (dr) dr.stepCount = event.step;

        // Update sub-agent status text
        const stepStatus = `Step ${event.step}/${event.maxSteps}: ${truncate(event.decision, 100)}`;
        messages.push({
          type: 'subagentToolDone',
          id: this.agentId,
          parentToolId: `dr-${event.parentToolId}`,
          toolId: `dr-action-${event.parentToolId}-${event.step - 1}`,
        });
        messages.push({
          type: 'subagentToolStart',
          id: this.agentId,
          parentToolId: `dr-${event.parentToolId}`,
          toolId: `dr-action-${event.parentToolId}-${event.step}`,
          status: stepStatus,
        });
        break;
      }

      case 'droidrun_result': {
        this.activeDroidruns.delete(event.parentToolId);
        // Clear sub-agent
        messages.push({
          type: 'subagentClear',
          id: this.agentId,
          parentToolId: `dr-${event.parentToolId}`,
        });
        break;
      }

      case 'droidrun_log':
        // Informational only, no webview action needed
        break;

      case 'session_end': {
        // Clear all tools and go idle
        messages.push(
          { type: 'agentToolsClear', id: this.agentId },
          { type: 'agentStatus', id: this.agentId, status: 'idle' },
        );
        this.activeTools.clear();
        this.toolStatusText.clear();
        this.activeDroidruns.clear();
        break;
      }
    }

    return messages;
  }

  /** Reset all state (e.g., on reconnect or new session) */
  reset(): void {
    this.activeTools.clear();
    this.toolStatusText.clear();
    this.activeDroidruns.clear();
  }

  private buildToolStatus(toolName: string, extension: string): string {
    // Map to status text that extractToolName() in toolUtils.ts can parse
    // for correct animation (typing vs reading)
    const toolMap: Record<string, string> = {
      shell: 'Bash',
      get_testcase_details: 'Read',
      todo_write: 'Write',
      read_file: 'Read',
      write_file: 'Write',
      edit_file: 'Edit',
      list_directory: 'Glob',
      search_files: 'Grep',
    };

    const mappedTool = toolMap[toolName] ?? toolName;
    return `${mappedTool}: ${extension}`;
  }

  private buildToolStatusWithArgs(currentStatus: string, key: string, value: string): string {
    // For shell commands, show the command itself
    if (key === 'command') {
      return `Bash: ${truncate(value, 150)}`;
    }
    // For other args, append key=value
    if (key === 'testcase_id') {
      return `Read: 測試案例 ${value}`;
    }
    return `${currentStatus} — ${key}: ${truncate(value, 80)}`;
  }
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}
