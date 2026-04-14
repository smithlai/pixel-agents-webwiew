import { useCallback, useRef, useState } from 'react';

import type { DeviceInfo, SubagentCharacter } from '../hooks/useExtensionMessages.js';
import { DEFAULT_PROFILES, getRoomDisplayName } from '../office/agentProfiles.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';

/** Agent IDs at or above this are dynamic device Testers */
const DEVICE_AGENT_ID_START = 200;

// ── Constants ────────────────────────────────────────────────────────────────

/** Max history entries per agent */
const MAX_HISTORY = 50;
/** Default visible lines before collapsing */
const COLLAPSED_LINES = 4;

/** Panel width constraints */
const PANEL_MIN_WIDTH = 250;
const PANEL_MAX_WIDTH = 1200;
const PANEL_DEFAULT_WIDTH = 680;

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
  deviceInfo: Record<number, DeviceInfo>;
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

  if (hasPermission) return { color: 'var(--color-status-permission)', label: '需要批准' };
  if (isActive && hasActiveTools) return { color: 'var(--color-status-active)', label: '工作中' };
  if (isActive) return { color: 'var(--color-status-active)', label: '工作中' };
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
  deviceInfo,
  nested,
}: {
  id: number;
  officeState: OfficeState;
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  history: HistoryEntry[];
  deviceInfo: Record<number, DeviceInfo>;
  /** When true, card is rendered as a nested child (no border, compact padding) */
  nested?: boolean;
}) {
  const ch = officeState.characters.get(id);
  const [expanded, setExpanded] = useState(false);
  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);

  if (!ch) return null;

  const isSub = ch.isSubagent;
  const sub = isSub ? subagentCharacters.find((s) => s.id === id) : null;
  const activityText = isSub
    ? (sub?.label ?? 'Subtask')
    : getActivityText(id, agentTools, ch.isActive);
  const status = getStatusInfo(id, agentTools, ch.isActive, isSub, ch.bubbleType);
  const profile = ch.profileKey ? DEFAULT_PROFILES[ch.profileKey] : null;
  const name = isSub
    ? (sub?.name ?? `Agent ${id}`)
    : ch.folderName ?? profile?.name ?? `Agent ${id}`;
  const modelLabel = profile?.model;
  const roomLabel = profile ? getRoomDisplayName(profile) : null;

  const isDeviceTester = id >= DEVICE_AGENT_ID_START && !isSub;
  const device = deviceInfo[id];

  // Reverse: newest first
  const reversed = [...history].reverse();
  const hasMore = reversed.length > COLLAPSED_LINES;
  const visibleHistory = expanded ? reversed : reversed.slice(0, COLLAPSED_LINES);
  const hiddenCount = reversed.length - COLLAPSED_LINES;

  return (
    <div
      style={{
        padding: nested ? '4px 8px' : '6px 10px',
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
            color: 'var(--vscode-foreground, var(--color-text))',
            fontWeight: isSub ? undefined : 'bold',
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: '16px', color: 'var(--color-text-muted)', flexShrink: 0 }}>
          [{status.label}]
        </span>
        {modelLabel && (
          <span style={{ fontSize: '13px', color: 'var(--color-accent)', flexShrink: 0 }}>
            {modelLabel}
          </span>
        )}
        <span
          style={{
            fontSize: '14px',
            color: 'var(--color-text)',
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
      {/* Room label */}
      {roomLabel && !isSub && (
        <div style={{ paddingLeft: 16, fontSize: '13px', color: 'var(--color-text-muted)', opacity: 0.7 }}>
          {roomLabel}
        </div>
      )}

      {/* Device info + stop button for dynamic Testers */}
      {isDeviceTester && device && (
        <div style={{ paddingLeft: 16, display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
            📱 {device.serial}
          </span>
          {ch.isActive && (
            <button
              onClick={() => {
                fetch('/goose/kill', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ serial: device.serial }),
                }).catch(() => {});
              }}
              style={{
                background: '#c53030',
                color: '#fff',
                border: '2px solid #9b2c2c',
                padding: '1px 8px',
                fontSize: '12px',
                cursor: 'pointer',
                lineHeight: 1.4,
              }}
            >
              ■ 停止
            </button>
          )}
        </div>
      )}

      {/* History lines */}
      {visibleHistory.length > 0 && (
        <div style={{ padding: '3px 0 0 16px' }}>
          {visibleHistory.map((entry, i) => (
            <div
              key={`${entry.timestamp.getTime()}-${i}`}
              style={{
                fontSize: '14px',
                color: 'var(--color-text-muted)',
                opacity: 0.85,
                display: 'flex',
                gap: 6,
                lineHeight: 1.5,
              }}
            >
              <span
                style={{
                  color: 'var(--color-text-muted)',
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
                color: 'var(--color-accent)',
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
  deviceInfo,
}: AgentStatusPanelProps) {
  const historyMap = useActivityHistory(agents, agentTools, subagentCharacters, officeState);

  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(PANEL_DEFAULT_WIDTH);
  const handleRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [panelWidth]);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    // Panel is on the right side; dragging left = wider
    const delta = startXRef.current - e.clientX;
    setPanelWidth(Math.min(Math.max(startWidthRef.current + delta, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH));
  }, []);

  const handleResizeEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  if (agents.length === 0 && subagentCharacters.length === 0) return null;

  // Group sub-agents by parentAgentId
  const subsByParent = new Map<number, SubagentCharacter[]>();
  for (const sub of subagentCharacters) {
    const list = subsByParent.get(sub.parentAgentId) ?? [];
    list.push(sub);
    subsByParent.set(sub.parentAgentId, list);
  }

  return (
    <div
      className="panel-font"
      style={{
        width: panelWidth,
        height: '100%',
        background: 'var(--color-bg)',
        borderLeft: '2px solid var(--color-border)',
        padding: '8px 0',
        overflowY: 'auto',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Resize drag handle — invisible 8px zone over the left border */}
      <div
        ref={handleRef}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        style={{
          position: 'absolute',
          left: -4,
          top: 0,
          width: 8,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
          touchAction: 'none',
        }}
      />
      <div
        style={{
          fontSize: '18px',
          color: 'var(--color-text-muted)',
          padding: '0 10px 4px',
          borderBottom: '1px solid var(--color-border)',
          marginBottom: 4,
        }}
      >
        Agent Status
      </div>
      {agents.map((parentId) => {
        const children = subsByParent.get(parentId) ?? [];
        return (
          <div key={parentId} style={{ borderBottom: '1px solid var(--color-border)' }}>
            <AgentCard
              id={parentId}
              officeState={officeState}
              agentTools={agentTools}
              subagentCharacters={subagentCharacters}
              history={historyMap.get(parentId) ?? []}
              deviceInfo={deviceInfo}
            />
            {children.length > 0 && (
              <div
                style={{
                  marginLeft: 18,
                  borderLeft: '2px solid var(--color-border)',
                  marginBottom: 2,
                }}
              >
                {children.map((sub, i) => {
                  const isLast = i === children.length - 1;
                  return (
                    <div
                      key={sub.id}
                      style={{
                        position: 'relative',
                        // Cut the vertical border at the last child
                        ...(isLast ? { borderLeft: '2px solid transparent', marginLeft: -2 } : {}),
                      }}
                    >
                      {/* Tree connector: ├─ or └─ */}
                      <span
                        style={{
                          position: 'absolute',
                          left: isLast ? -2 : -2,
                          top: 0,
                          width: 12,
                          height: 16,
                          borderLeft: isLast ? '2px solid var(--color-border)' : 'none',
                          borderBottom: '2px solid var(--color-border)',
                          pointerEvents: 'none',
                        }}
                      />
                      <div style={{ marginLeft: 12 }}>
                        <AgentCard
                          id={sub.id}
                          officeState={officeState}
                          agentTools={agentTools}
                          subagentCharacters={subagentCharacters}
                          history={historyMap.get(sub.id) ?? []}
                          deviceInfo={deviceInfo}
                          nested
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
