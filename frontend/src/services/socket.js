// Thin wrapper around the native WebSocket with event routing and
// exponential-backoff reconnection.

const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3000/ws';

let socket = null;
let shouldReconnect = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
const handlers = new Map(); // event name -> Set<fn>
const statusListeners = new Set(); // fn(isConnected)

const MAX_BACKOFF_MS = 30000;
const BASE_BACKOFF_MS = 1000;

function notifyStatus(isConnected) {
  statusListeners.forEach((fn) => {
    try {
      fn(isConnected);
    } catch (e) {
      // ignore listener errors
    }
  });
}

function connect() {
  shouldReconnect = true;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    reconnectAttempts = 0;
    notifyStatus(true);
  };

  socket.onmessage = (event) => {
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    const { event: name, data } = parsed || {};
    if (!name) return;
    const set = handlers.get(name);
    if (set) {
      set.forEach((fn) => {
        try {
          fn(data);
        } catch (e) {
          // ignore handler errors
        }
      });
    }
  };

  socket.onclose = () => {
    notifyStatus(false);
    if (shouldReconnect) {
      scheduleReconnect();
    }
  };

  socket.onerror = () => {
    // onclose will follow and trigger reconnect.
    try {
      socket.close();
    } catch (e) {
      // ignore
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, reconnectAttempts), MAX_BACKOFF_MS);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (shouldReconnect) connect();
  }, delay);
}

function disconnect() {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch (e) {
      // ignore
    }
    socket = null;
  }
}

function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(handler);
}

function off(event, handler) {
  const set = handlers.get(event);
  if (set) {
    set.delete(handler);
    if (set.size === 0) handlers.delete(event);
  }
}

function onStatusChange(fn) {
  statusListeners.add(fn);
  // Push current state immediately.
  fn(!!socket && socket.readyState === WebSocket.OPEN);
  return () => statusListeners.delete(fn);
}

const socketService = { connect, disconnect, on, off, onStatusChange };
export default socketService;
