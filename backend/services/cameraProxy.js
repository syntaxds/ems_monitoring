'use strict';

const http = require('http');
const { URL } = require('url');

/**
 * MJPEG camera proxy.
 *
 * The ESP32-CAM serves only ONE concurrent /stream client and wedges if extra
 * browser connections pile up. This hub keeps a SINGLE upstream connection per
 * device and fans the raw multipart bytes out to any number of dashboard
 * clients, served from the backend's own origin (so no CORS/CSP/mixed-content
 * issues, and the camera never sees more than one viewer).
 */

const UPSTREAM_TIMEOUT_MS = 8000;
const hubs = new Map(); // deviceId -> { clients:Set<res>, upstreamReq, upstreamRes, contentType, url }

function getHub(deviceId) {
  let hub = hubs.get(deviceId);
  if (!hub) {
    hub = { clients: new Set(), upstreamReq: null, upstreamRes: null, contentType: null, url: null };
    hubs.set(deviceId, hub);
  }
  return hub;
}

function stop(deviceId) {
  const hub = hubs.get(deviceId);
  if (!hub) return;
  try { if (hub.upstreamRes) hub.upstreamRes.destroy(); } catch (_) { /* ignore */ }
  try { if (hub.upstreamReq) hub.upstreamReq.destroy(); } catch (_) { /* ignore */ }
  hubs.delete(deviceId);
}

function writeClientHeaders(res, contentType) {
  if (res.headersSent) return;
  try {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'close'
    });
  } catch (_) { /* ignore */ }
}

function endAllClients(hub, statusIfNoHeaders) {
  for (const c of hub.clients) {
    try {
      if (!c.headersSent && statusIfNoHeaders) c.writeHead(statusIfNoHeaders);
      c.end();
    } catch (_) { /* ignore */ }
  }
}

function startUpstream(deviceId) {
  const hub = hubs.get(deviceId);
  if (!hub || hub.upstreamReq) return;

  let u;
  try {
    u = new URL(hub.url);
  } catch (_) {
    endAllClients(hub, 502);
    stop(deviceId);
    return;
  }

  const req = http.get(
    {
      hostname: u.hostname,
      port: u.port || 80,
      path: (u.pathname || '/') + (u.search || ''),
      headers: { Connection: 'keep-alive' }
    },
    (upRes) => {
      if (upRes.statusCode !== 200) {
        upRes.resume();
        endAllClients(hub, 502);
        stop(deviceId);
        return;
      }
      hub.upstreamRes = upRes;
      hub.contentType = upRes.headers['content-type'] || 'multipart/x-mixed-replace';
      for (const c of hub.clients) writeClientHeaders(c, hub.contentType);

      upRes.on('data', (chunk) => {
        for (const c of hub.clients) {
          try { c.write(chunk); } catch (_) { /* ignore */ }
        }
      });
      upRes.on('end', () => { endAllClients(hub); stop(deviceId); });
      upRes.on('error', () => { endAllClients(hub); stop(deviceId); });
    }
  );

  req.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
    req.destroy();
    endAllClients(hub, 504);
    stop(deviceId);
  });
  req.on('error', () => { endAllClients(hub, 502); stop(deviceId); });

  hub.upstreamReq = req;
}

/**
 * Attach an Express response as a viewer of the device's live stream.
 * `url` is the upstream camera stream URL (e.g. http://<cam-ip>/stream).
 */
function attach(deviceId, url, req, res) {
  const hub = getHub(deviceId);
  hub.url = url;
  hub.clients.add(res);

  // Newcomer joining an already-running stream gets headers immediately.
  if (hub.contentType) writeClientHeaders(res, hub.contentType);

  const cleanup = () => {
    hub.clients.delete(res);
    if (hub.clients.size === 0) stop(deviceId);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);

  if (!hub.upstreamReq) startUpstream(deviceId);
}

module.exports = { attach };
