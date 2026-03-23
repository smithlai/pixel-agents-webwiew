import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';

interface AgentStatusPanelProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
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

export function AgentStatusPanel({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
}: AgentStatusPanelProps) {
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  if (allIds.length === 0) return null;

  return (
    <div
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
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSub = ch.isSubagent;
        const activityText = isSub
          ? subagentCharacters.find((s) => s.id === id)?.label ?? 'Subtask'
          : getActivityText(id, agentTools, ch.isActive);
        const status = getStatusInfo(id, agentTools, ch.isActive, isSub, ch.bubbleType);
        const name = ch.folderName ?? `Agent ${id}`;

        return (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '4px 10px',
            }}
          >
            {/* Status dot */}
            <span
              className={ch.isActive ? 'pixel-agents-pulse' : undefined}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: status.color,
                flexShrink: 0,
                marginTop: 5,
              }}
            />
            {/* Info */}
            <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                }}
              >
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
                <span
                  style={{
                    fontSize: '16px',
                    color: 'var(--pixel-text-dim)',
                    flexShrink: 0,
                  }}
                >
                  [{status.label}]
                </span>
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: 'var(--pixel-text-dim)',
                  wordBreak: 'break-word',
                }}
              >
                {activityText}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
