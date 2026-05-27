'use strict';

const { WebSocketServer, WebSocket } = require('ws');

let wss = null;

/**
 * Attach a WebSocket server to the existing HTTP server (shares the port).
 * On connect, each client receives a `connected` event with the server time.
 */
function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, req) => {
    const remote = req.socket.remoteAddress;
    console.log(`[WS] Client connected from ${remote} (total: ${wss.clients.size})`);

    send(socket, 'connected', { server_time: new Date().toISOString() });

    socket.on('error', (err) => {
      console.error(`[WS] Client socket error: ${err.message}`);
    });

    socket.on('close', () => {
      console.log(`[WS] Client disconnected (total: ${wss.clients.size})`);
    });
  });

  wss.on('error', (err) => {
    console.error(`[WS] Server error: ${err.message}`);
  });

  console.log('[WS] WebSocket server initialized on path /ws');
  return wss;
}

function send(socket, event, data) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ event, data }));
  }
}

/**
 * Broadcast a JSON envelope { event, data } to every connected client whose
 * socket is OPEN. No-op if the server has not been initialized.
 */
function broadcast(eventName, payload) {
  if (!wss) {
    console.warn('[WS] broadcast called before init — dropping message');
    return;
  }
  const message = JSON.stringify({ event: eventName, data: payload });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Close all client connections and the server. Used during graceful shutdown.
 */
function close() {
  if (!wss) return;
  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch (_) {
      // ignore
    }
  }
  wss.close();
  console.log('[WS] WebSocket server closed');
}

module.exports = { init, broadcast, close };
