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

/** Message types dispatched directly (not wrapped in goose-events) */
const DIRECT_DISPATCH_TYPES = new Set([
  'devices-update',
  'task-assigned',
  'task-stopped',
]);

function handleMessage(event: MessageEvent): void {
  try {
    const payload = JSON.parse(event.data as string) as {
      type: string;
      messages?: unknown[];
    };

    // Direct dispatch for device-related messages
    if (DIRECT_DISPATCH_TYPES.has(payload.type)) {
      dispatch(payload);
      return;
    }

    if (payload.type === 'goose-events' && payload.messages) {
      // Real-time events or buffered replay — dispatch each as a webview message
      for (const msg of payload.messages) {
        dispatch(msg);
      }
    }
  } catch {
    // Ignore malformed messages
  }
}

/**
 * Pull device list via REST — fallback for when WebSocket push
 * arrives before AdbPoller has finished its first async poll.
 * Retries once after a short delay to cover the poll latency.
 */
function fetchDevices(): void {
  const doFetch = () =>
    fetch('/goose/devices')
      .then(r => r.json())
      .then((data: { devices?: unknown[] }) => {
        if (data.devices && (data.devices as unknown[]).length > 0) {
          dispatch({ type: 'devices-update', devices: data.devices });
        }
      })
      .catch(() => {});

  // Immediate try + retry after 3s (covers ADB poll lag)
  doFetch();
  setTimeout(doFetch, 3000);
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
    // Pull current devices via REST as fallback — WebSocket push
    // may arrive before AdbPoller's first async poll completes.
    fetchDevices();
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
