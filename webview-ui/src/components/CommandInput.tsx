import { useCallback, useRef, useState } from 'react';

import type { DeviceInfo } from '../hooks/useExtensionMessages.js';

interface CommandInputProps {
  /** 送出指令時觸發（command + optional serial） */
  onSubmit: (command: string, serial?: string) => void;
  /** 目前偵測到的裝置清單（agentId → DeviceInfo） */
  deviceInfo: Record<number, DeviceInfo>;
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  // Keep the command box above the bottom-left toolbar to avoid overlap.
  bottom: 58,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 'var(--pixel-controls-z)' as unknown as number,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--color-bg)',
  border: '2px solid var(--color-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--shadow-pixel)',
  width: 'min(640px, 70vw)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '5px 10px',
  fontSize: '16px',
  color: 'var(--color-text)',
  background: 'var(--color-btn-bg)',
  border: '2px solid var(--color-border)',
  borderRadius: 0,
  outline: 'none',
  fontFamily: "'Segoe UI', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
};

const btnStyle: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: '22px',
  color: 'var(--color-agent-text)',
  background: 'var(--color-agent-bg)',
  border: '2px solid var(--color-agent-border)',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

const selectStyle: React.CSSProperties = {
  padding: '5px 6px',
  fontSize: '14px',
  color: 'var(--color-text)',
  background: 'var(--color-btn-bg)',
  border: '2px solid var(--color-border)',
  borderRadius: 0,
  outline: 'none',
  fontFamily: "'Segoe UI', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
  maxWidth: 160,
};

export function CommandInput({ onSubmit, deviceInfo }: CommandInputProps) {
  const [value, setValue] = useState('');
  const [selectedSerial, setSelectedSerial] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const devices = Object.values(deviceInfo);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed, selectedSerial || undefined);
    setValue('');
  }, [value, selectedSerial, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
      // Stop propagation so editor keyboard shortcuts don't fire
      e.stopPropagation();
    },
    [handleSubmit],
  );

  return (
    <div style={containerStyle}>
      <span style={{ fontSize: '22px', color: 'var(--color-text-muted)', padding: '0 4px', whiteSpace: 'nowrap' }}>
        Boss &gt;
      </span>
      {devices.length > 1 && (
        <select
          value={selectedSerial}
          onChange={(e) => setSelectedSerial(e.target.value)}
          style={selectStyle}
          title="選擇目標裝置"
        >
          <option value="">自動分配</option>
          {devices.map((d) => (
            <option key={d.serial} value={d.serial} disabled={d.state === 'active'}>
              {d.model}{d.state === 'active' ? ' (忙碌)' : ''}
            </option>
          ))}
        </select>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="輸入指令..."
        style={inputStyle}
      />
      <button onClick={handleSubmit} style={btnStyle}>
        送出
      </button>
    </div>
  );
}
