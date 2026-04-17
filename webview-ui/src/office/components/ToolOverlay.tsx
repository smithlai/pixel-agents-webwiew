import { useEffect, useRef, useState } from 'react';

import {
  CHARACTER_SITTING_OFFSET_PX,
  TOOL_OVERLAY_ACTIVITY_FONT_PX,
  TOOL_OVERLAY_ACTIVITY_PADDING_X_PX,
  TOOL_OVERLAY_ACTIVITY_PADDING_Y_PX,
  TOOL_OVERLAY_NAME_FONT_PX,
  TOOL_OVERLAY_SUB_NAME_FONT_PX,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import { DEFAULT_PROFILES, shouldShowAgentNameTag } from '../agentProfiles.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  if (!isActive) return 'Idle';
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    const lastTool = tools[tools.length - 1];
    if (lastTool) return lastTool.status;
  }
  return 'Idle';
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Track when activity text last changed per agent — hide after 5s of no update
  const activityTimestampRef = useRef<Map<number, { text: string; shownAt: number }>>(new Map());
  const ACTIVITY_AUTO_HIDE_MS = 5000;

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const profile = ch.profileKey ? DEFAULT_PROFILES[ch.profileKey] : null;
        if (!ch.isSubagent && !shouldShowAgentNameTag(profile)) {
          return null;
        }

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;
        const hasTextBubble = ch.bubbleType === 'text' && !!ch.bubbleText;

        // Only show for hovered/selected agents (unless always-show is on).
        // Text bubbles force visibility so ambient chat can always be seen.
        if (!alwaysShowOverlay && !isSelected && !isHovered && !hasTextBubble) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        const nowMs = Date.now();
        let activityText: string;
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else {
            const sub = subagentCharacters.find((s) => s.id === id);
            activityText = sub ? sub.label : 'Subtask';
          }
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive);
        }

        // Track activity text changes — reset timer when text changes (ignore Idle)
        const prevEntry = activityTimestampRef.current.get(id);
        const isMeaningfulText = activityText !== 'Idle';
        if (isMeaningfulText && (!prevEntry || prevEntry.text !== activityText)) {
          activityTimestampRef.current.set(id, { text: activityText, shownAt: nowMs });
        }
        const shownAt = activityTimestampRef.current.get(id)?.shownAt ?? 0;
        const showActivityText = isMeaningfulText && nowMs - shownAt < ACTIVITY_AUTO_HIDE_MS;

        // Permanent display name — separate from the temporary activity text
        const displayName = isSub
          ? (subagentCharacters.find((s) => s.id === id)?.name ?? 'Subtask')
          : (profile?.name ?? ch.folderName ?? `Agent ${id}`);
        const textBubbleMessage = hasTextBubble ? (ch.bubbleText ?? '') : '';

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;

        let dotColor: string | null = null;
        if (hasPermission) {
          dotColor = 'var(--color-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--color-status-active)';
        }

        return (
          <div
            key={id}
            className="panel-font"
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translateX(-50%) translateY(-100%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity: alwaysShowOverlay && !isSelected && !isHovered ? (isSub ? 0.5 : 0.75) : 1,
              zIndex: isSelected ? 'var(--pixel-overlay-selected-z)' : 'var(--pixel-overlay-z)',
            }}
          >
            {/* Text bubble from OfficeState (DOM-only for consistent font/layout) */}
            {hasTextBubble && (
              <div
                style={{
                  background: 'rgba(10, 10, 20, 0.88)',
                  border: '1px solid var(--color-border)',
                  padding: `${TOOL_OVERLAY_ACTIVITY_PADDING_Y_PX}px ${TOOL_OVERLAY_ACTIVITY_PADDING_X_PX}px`,
                  maxWidth: 360,
                  minWidth: 160,
                  fontSize: `${TOOL_OVERLAY_ACTIVITY_FONT_PX}px`,
                  color: 'var(--color-text)',
                  boxShadow: 'var(--shadow-pixel)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.22)' }} />
                <div
                  style={{
                    fontWeight: 700,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    lineHeight: 1.35,
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {textBubbleMessage}
                </div>
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.22)' }} />
              </div>
            )}
            {/* Activity bubble — auto-hides 5s after last change */}
            {showActivityText && !hasTextBubble && (
              <div
                style={{
                  background: 'rgba(10, 10, 20, 0.72)',
                  border: '1px solid var(--color-border)',
                  padding: `${TOOL_OVERLAY_ACTIVITY_PADDING_Y_PX}px ${TOOL_OVERLAY_ACTIVITY_PADDING_X_PX}px`,
                  maxWidth: 240,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: `${TOOL_OVERLAY_ACTIVITY_FONT_PX}px`,
                  color: 'var(--color-text)',
                  boxShadow: 'var(--shadow-pixel)',
                }}
              >
                {activityText}
              </div>
            )}
            {/* Name tag — hide while text bubble is shown to avoid overlap */}
            {!hasTextBubble && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'var(--color-bg)',
                  border: 'none',
                  borderRadius: 0,
                  padding: isSelected ? '3px 6px 3px 8px' : '3px 8px',
                  boxShadow: 'var(--shadow-pixel)',
                  whiteSpace: 'nowrap',
                  maxWidth: 220,
                }}
              >
                {dotColor && (
                  <span
                    className={isActive && !hasPermission ? 'pixel-agents-pulse' : undefined}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: dotColor,
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: isSub
                      ? `${TOOL_OVERLAY_SUB_NAME_FONT_PX}px`
                      : `${TOOL_OVERLAY_NAME_FONT_PX}px`,
                    lineHeight: 1.3,
                    fontStyle: isSub ? 'italic' : undefined,
                    color: 'var(--vscode-foreground, var(--color-text))',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                    maxWidth: 180,
                  }}
                >
                  {displayName}
                </span>
                {isSelected && !isSub && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseAgent(id);
                    }}
                    title="Close agent"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-close-text)',
                      cursor: 'pointer',
                      padding: '0 2px',
                      fontSize: '26px',
                      lineHeight: 1,
                      marginLeft: 2,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--color-close-hover)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--color-close-text)';
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
