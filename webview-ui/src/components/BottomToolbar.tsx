import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { vscode } from '../webviewBridge.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
  showAgentButton?: boolean;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--color-bg)',
  border: '2px solid var(--color-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--shadow-pixel)',
};

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--color-text)',
  background: 'var(--color-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--color-active-bg)',
  border: '2px solid var(--color-accent)',
};

export function BottomToolbar({
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
  showAgentButton = true,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [hoveredFolder, setHoveredFolder] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const folderPickerRef = useRef<HTMLDivElement>(null);

  // Close folder picker on outside click
  useEffect(() => {
    if (!isFolderPickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    vscode.postMessage({ type: 'openClaude', folderPath: folder.path });
  };

  if (collapsed) {
    return (
      <div style={panelStyle}>
        <button
          onClick={() => { setCollapsed(false); setIsFolderPickerOpen(false); }}
          onMouseEnter={() => setHovered('expand')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'expand' ? 'var(--color-btn-hover)' : btnBase.background,
          }}
          title="展開工具列"
        >
          ☰
        </button>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <button
        onClick={() => { setCollapsed(true); setIsFolderPickerOpen(false); }}
        onMouseEnter={() => setHovered('collapse')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: hovered === 'collapse' ? 'var(--color-btn-hover)' : btnBase.background,
        }}
        title="收折工具列"
      >
        ✕
      </button>
      {showAgentButton && (
        <div ref={folderPickerRef} style={{ position: 'relative' }}>
          <button
            onClick={handleAgentClick}
            onMouseEnter={() => setHovered('agent')}
            onMouseLeave={() => setHovered(null)}
            style={{
              ...btnBase,
              padding: '5px 12px',
              background:
                hovered === 'agent' || isFolderPickerOpen
                  ? 'var(--color-agent-hover)'
                  : 'var(--color-agent-bg)',
              border: '2px solid var(--color-agent-border)',
              color: 'var(--color-agent-text)',
            }}
          >
            + Agent
          </button>
          {isFolderPickerOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 4,
                background: 'var(--color-bg)',
                border: '2px solid var(--color-border)',
                borderRadius: 0,
                boxShadow: 'var(--shadow-pixel)',
                minWidth: 160,
                zIndex: 'var(--pixel-controls-z)',
              }}
            >
              {workspaceFolders.map((folder, i) => (
                <button
                  key={folder.path}
                  onClick={() => handleFolderSelect(folder)}
                  onMouseEnter={() => setHoveredFolder(i)}
                  onMouseLeave={() => setHoveredFolder(null)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    fontSize: '22px',
                    color: 'var(--color-text)',
                    background: hoveredFolder === i ? 'var(--color-btn-hover)' : 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {folder.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'edit' ? 'var(--color-btn-hover)' : btnBase.background,
              }
        }
        title="Edit office layout"
      >
        Layout
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={onToggleSettings}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background:
                    hovered === 'settings' ? 'var(--color-btn-hover)' : btnBase.background,
                }
          }
          title="Settings"
        >
          Settings
        </button>
      </div>
    </div>
  );
}
