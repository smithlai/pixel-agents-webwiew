import { isBrowserRuntime } from './runtime';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const LAYOUT_STORAGE_KEY = 'goose-office-layout';

function browserPostMessage(msg: unknown): void {
  const m = msg as Record<string, unknown>;
  if (m.type === 'saveLayout' && m.layout) {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(m.layout));
      console.log('[vscode.postMessage] Layout saved to localStorage');
    } catch {
      console.warn('[vscode.postMessage] Failed to save layout to localStorage');
    }
  } else {
    console.log('[vscode.postMessage]', msg);
  }
}

export function loadSavedLayout(): unknown | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as unknown;
  } catch {
    // ignore
  }
  return null;
}

export const vscode: { postMessage(msg: unknown): void } = isBrowserRuntime
  ? { postMessage: browserPostMessage }
  : (acquireVsCodeApi() as { postMessage(msg: unknown): void });
