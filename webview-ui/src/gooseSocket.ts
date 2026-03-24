/**
 * WebSocket client for receiving Goose events from the Vite dev server.
 *
 * Connects to /goose-ws, receives translated webview messages,
 * and dispatches them as window MessageEvents — same format that
 * useExtensionMessages.ts already handles.
 *
 * Only active in browser runtime mode.
 */

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 20;

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function getWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/goose-ws`;
}

function dispatch(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

function handleMessage(event: MessageEvent): void {
  try {
    const payload = JSON.parse(event.data as string) as {
      type: string;
      messages?: unknown[];
      events?: string[];
    };

    if (payload.type === 'goose-events' && payload.messages) {
      // Real-time events — dispatch each as a webview message
      for (const msg of payload.messages) {
        dispatch(msg);
      }
    } else if (payload.type === 'goose-buffer' && payload.events) {
      // Buffered events on connect — replay (these are raw GooseEvent JSON strings,
      // but the server already translates them, so this is pre-translated messages)
      // Note: buffer replay is handled server-side; we just log for now
      console.log(`[GooseSocket] Received ${payload.events.length} buffered events`);
    }
  } catch {
    // Ignore malformed messages
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = getWsUrl();
  console.log(`[GooseSocket] Connecting to ${url}...`);

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[GooseSocket] Connected');
    reconnectAttempts = 0;
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    ws = null;
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(
        `[GooseSocket] Disconnected, reconnecting in ${RECONNECT_DELAY_MS}ms (attempt ${reconnectAttempts})`,
      );
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    } else {
      console.log('[GooseSocket] Max reconnect attempts reached, giving up');
    }
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

/** Start the WebSocket connection to the Goose event server */
export function initGooseSocket(): void {
  connect();
}

/** Clean up the WebSocket connection */
export function destroyGooseSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent reconnect
}
