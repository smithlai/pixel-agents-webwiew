import { useCallback, useRef, useState } from 'react';

import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Max history entries per agent */
const MAX_HISTORY = 50;
/** Default visible lines before collapsing */
const COLLAPSED_LINES = 4;

// ── Types ────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  text: string;
  timestamp: Date;
}

interface AgentStatusPanelProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(d: Date): string {
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }
  return 'Idle';
}

function getStatusInfo(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
  isSub: boolean,
  bubbleType: string | null,
): { color: string; label: string } {
  const tools = agentTools[agentId];
  const hasPermission =
    (isSub && bubbleType === 'permission') || tools?.some((t) => t.permissionWait && !t.done);
  const hasActiveTools = tools?.some((t) => !t.done);

  if (hasPermission) return { color: 'var(--pixel-status-permission)', label: '需要批准' };
  if (isActive && hasActiveTools) return { color: 'var(--pixel-status-active)', label: '工作中' };
  if (isActive) return { color: 'var(--pixel-status-active)', label: '工作中' };
  return { color: 'rgba(255,255,255,0.3)', label: '待命' };
}

// ── History hook ─────────────────────────────────────────────────────────────

function useActivityHistory(
  agents: number[],
  agentTools: Record<number, ToolActivity[]>,
  subagentCharacters: SubagentCharacter[],
  officeState: OfficeState,
): Map<number, HistoryEntry[]> {
  const historyRef = useRef(new Map<number, HistoryEntry[]>());
  const seenToolsRef = useRef(new Set<string>());

  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  for (const id of allIds) {
    const ch = officeState.characters.get(id);
    if (!ch) continue;

    const isSub = ch.isSubagent;
    const tools = agentTools[id];

    if (!historyRef.current.has(id)) {
      historyRef.current.set(id, []);
    }
    const history = historyRef.current.get(id)!;

    if (tools) {
      for (const tool of tools) {
        const key = `${id}:${tool.toolId}:${tool.status}`;
        if (!seenToolsRef.current.has(key)) {
          seenToolsRef.current.add(key);
          const text = isSub
            ? (subagentCharacters.find((s) => s.id === id)?.label ?? 'Subtask')
            : tool.status;
          history.push({ text, timestamp: new Date() });
          if (history.length > MAX_HISTORY) {
            history.splice(0, history.length - MAX_HISTORY);
          }
        }
      }
    }
  }

  for (const id of historyRef.current.keys()) {
    if (!allIds.includes(id)) {
      historyRef.current.delete(id);
    }
  }

  return historyRef.current;
}

// ── Agent card component ─────────────────────────────────────────────────────

function AgentCard({
  id,
  officeState,
  agentTools,
  subagentCharacters,
  history,
}: {
  id: number;
  officeState: OfficeState;
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  history: HistoryEntry[];
}) {
  const ch = officeState.characters.get(id);
  const [expanded, setExpanded] = useState(false);
  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);

  if (!ch) return null;

  const isSub = ch.isSubagent;
  const activityText = isSub
    ? (subagentCharacters.find((s) => s.id === id)?.label ?? 'Subtask')
    : getActivityText(id, agentTools, ch.isActive);
  const status = getStatusInfo(id, agentTools, ch.isActive, isSub, ch.bubbleType);
  const name = ch.folderName ?? `Agent ${id}`;

  // Reverse: newest first
  const reversed = [...history].reverse();
  const hasMore = reversed.length > COLLAPSED_LINES;
  const visibleHistory = expanded ? reversed : reversed.slice(0, COLLAPSED_LINES);
  const hiddenCount = reversed.length - COLLAPSED_LINES;

  return (
    <div
      style={{
        padding: '6px 10px',
        borderBottom: '1px solid var(--pixel-border)',
      }}
    >
      {/* Header: name + status + current activity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          className={ch.isActive ? 'pixel-agents-pulse' : undefined}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: status.color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: isSub ? '18px' : '20px',
            fontStyle: isSub ? 'italic' : undefined,
            color: 'var(--vscode-foreground, var(--pixel-text))',
            fontWeight: isSub ? undefined : 'bold',
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: '16px', color: 'var(--pixel-text-dim)', flexShrink: 0 }}>
          [{status.label}]
        </span>
        <span
          style={{
            fontSize: '14px',
            color: 'var(--pixel-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {activityText}
        </span>
      </div>

      {/* History lines */}
      {visibleHistory.length > 0 && (
        <div style={{ padding: '3px 0 0 16px' }}>
          {visibleHistory.map((entry, i) => (
            <div
              key={`${entry.timestamp.getTime()}-${i}`}
              style={{
                fontSize: '14px',
                color: 'var(--pixel-text-dim)',
                opacity: 0.85,
                display: 'flex',
                gap: 6,
                lineHeight: 1.5,
              }}
            >
              <span
                style={{
                  color: 'var(--pixel-text-dim)',
                  flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                  opacity: 0.7,
                }}
              >
                {formatTime(entry.timestamp)}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.text}
              </span>
            </div>
          ))}

          {/* Expand/collapse toggle */}
          {hasMore && (
            <div
              onClick={toggleExpand}
              style={{
                fontSize: '13px',
                color: 'var(--pixel-accent)',
                cursor: 'pointer',
                marginTop: 2,
                userSelect: 'none',
              }}
            >
              {expanded ? '收合' : `更多 +${hiddenCount}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function AgentStatusPanel({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
}: AgentStatusPanelProps) {
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];
  const historyMap = useActivityHistory(agents, agentTools, subagentCharacters, officeState);

  if (allIds.length === 0) return null;

  return (
    <div
      className="panel-font"
      style={{
        width: 560,
        height: '100%',
        background: 'var(--pixel-bg)',
        borderLeft: '2px solid var(--pixel-border)',
        padding: '8px 0',
        overflowY: 'auto',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: '18px',
          color: 'var(--pixel-text-dim)',
          padding: '0 10px 4px',
          borderBottom: '1px solid var(--pixel-border)',
          marginBottom: 4,
        }}
      >
        Agent Status
      </div>
      {allIds.map((id) => (
        <AgentCard
          key={id}
          id={id}
          officeState={officeState}
          agentTools={agentTools}
          subagentCharacters={subagentCharacters}
          history={historyMap.get(id) ?? []}
        />
      ))}
    </div>
  );
}
