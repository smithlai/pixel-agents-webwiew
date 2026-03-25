import { useCallback, useRef, useState } from 'react';

interface CommandInputProps {
  /** 送出指令時觸發 */
  onSubmit: (command: string) => void;
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 'var(--pixel-controls-z)' as unknown as number,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
  width: 'min(640px, 70vw)',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '5px 10px',
  fontSize: '16px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  outline: 'none',
  fontFamily: "'Segoe UI', 'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
};

const btnStyle: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: '22px',
  color: 'var(--pixel-agent-text)',
  background: 'var(--pixel-agent-bg)',
  border: '2px solid var(--pixel-agent-border)',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

export function CommandInput({ onSubmit }: CommandInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  }, [value, onSubmit]);

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
      <span style={{ fontSize: '22px', color: 'var(--pixel-text-dim)', padding: '0 4px', whiteSpace: 'nowrap' }}>
        Boss &gt;
      </span>
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
