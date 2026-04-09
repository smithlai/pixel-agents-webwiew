/**
 * Webview 訊息橋接層 — UI ↔ 後端的統一 postMessage 介面。
 *
 * 來源端：React UI 元件透過 vscode.postMessage({ type, ... })
 * 目標端：
 *   - VS Code 模式 → Extension backend (PixelAgentsViewProvider)
 *   - Browser 模式 → Vite dev server REST API (viteGoosePlugin)
 *
 * 自動偵測 runtime 環境，選擇對應的訊息傳輸實作。
 */

import { isBrowserRuntime } from './runtime';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const BROWSER_STATE_ENDPOINT = '/pixel-agents-web/state';
// Legacy key — used to migrate data saved before server-state was introduced
const LEGACY_LAYOUT_STORAGE_KEY = 'goose-office-layout';

// ── Server-side state helpers (browser mode only) ───────────────────────────

async function readServerState(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(BROWSER_STATE_ENDPOINT);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function patchServerState(patch: Record<string, unknown>): Promise<void> {
  try {
    await fetch(BROWSER_STATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    console.warn('[vscodeApi] Failed to persist state to server');
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

function browserPostMessage(msg: unknown): void {
  const m = msg as Record<string, unknown>;
  if (m.type === 'saveLayout' && m.layout) {
    void patchServerState({ layout: m.layout });
  } else if (m.type === 'saveAgentSeats' && m.agentSeats) {
    void patchServerState({ agentSeats: m.agentSeats });
  } else if (m.type === 'setSoundEnabled') {
    void patchServerState({ soundEnabled: m.enabled });
  } else if (m.type === 'setWatchAllSessions') {
    void patchServerState({ watchAllSessions: m.enabled });
  } else if (m.type === 'setHooksEnabled') {
    void patchServerState({ hooksEnabled: m.enabled });
  } else if (m.type === 'setAlwaysShowLabels') {
    void patchServerState({ alwaysShowLabels: m.enabled });
  } else if (m.type === 'setLastSeenVersion') {
    void patchServerState({ lastSeenVersion: m.version });
  } else if (m.type === 'setHooksInfoShown') {
    void patchServerState({ hooksInfoShown: m.shown });
  } else {
    console.log('[vscode.postMessage]', msg);
  }
}

export async function loadSavedLayout(): Promise<unknown | null> {
  // 1. Try server state
  const state = await readServerState();
  if (state.layout) return state.layout;

  // 2. Legacy migration: localStorage → server state (runs once, then removed)
  try {
    const raw = localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY);
    if (raw) {
      const layout = JSON.parse(raw) as unknown;
      console.log('[vscodeApi] Migrating layout from localStorage → server state');
      await patchServerState({ layout });
      localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY);
      return layout;
    }
  } catch {
    // ignore migration errors
  }

  return null;
}

export async function loadBrowserPersistedSettings(): Promise<Record<string, unknown>> {
  const state = await readServerState();
  const { layout: _l, ...settings } = state;
  void _l; // layout is handled separately
  return settings;
}

export const vscode: { postMessage(msg: unknown): void } = isBrowserRuntime
  ? { postMessage: browserPostMessage }
  : (acquireVsCodeApi() as { postMessage(msg: unknown): void });
