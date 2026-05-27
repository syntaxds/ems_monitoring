'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const db = require('./db');
const { apiRateLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const alertRoutes = require('./routes/alerts');
const reportRoutes = require('./routes/reports');
const internalRoutes = require('./routes/internal');

const mqttService = require('./services/mqttService');
const wsService = require('./services/wsService');

const app = express();

// Behind a single reverse proxy in production; trust the first hop so req.ip
// is correct for rate limiting and the loopback check.
app.set('trust proxy', 1);

// --- Security headers (CSP allows Leaflet CDN tiles + inline styles) ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // 'http:' allows live MJPEG camera streams served from devices' LAN IPs
        // (e.g. http://192.168.0.x/stream), whose addresses are dynamic.
        imgSrc: ["'self'", 'data:', 'blob:', 'http:', 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// --- CORS restricted to the configured dashboard origin ---
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
  })
);

app.use(express.json({ limit: '1mb' }));

// --- Rate limit (skips /internal/*) ---
app.use(apiRateLimiter);

// --- Static camera media ---
app.use(
  '/media/cameras',
  express.static(path.resolve(process.env.UPLOAD_DIR || './uploads/cameras'))
);

// --- Health check ---
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// --- Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/reports', reportRoutes);
app.use('/internal', internalRoutes);

// --- Optional single-origin production hosting ---
// When SERVE_FRONTEND=true, serve the compiled React build from this server so
// the dashboard and API share one origin (no CORS). Default off keeps the
// documented separate-origin architecture. Run `npm run build` in /frontend first.
if (process.env.SERVE_FRONTEND === 'true') {
  const buildDir = path.resolve(__dirname, '..', 'frontend', 'build');
  if (fs.existsSync(path.join(buildDir, 'index.html'))) {
    app.use(express.static(buildDir));
    // SPA fallback for client-side routes (never shadows api/internal/media/health/ws).
    app.get(/^\/(?!api|internal|media|health|ws).*/, (req, res) => {
      res.sendFile(path.join(buildDir, 'index.html'));
    });
    console.log(`[Server] Serving frontend build from ${buildDir}`);
  } else {
    console.warn('[Server] SERVE_FRONTEND=true but frontend/build/index.html not found — run "npm run build" in /frontend.');
  }
}

// --- 404 + error handler (last) ---
app.use(notFoundHandler);
app.use(errorHandler);

// In CI we only verify the module loads; never bind a port.
if (process.env.CI === 'true') {
  module.exports = app;
} else {
  start();
}

let server;

async function start() {
  try {
    await db.testConnection();
    await db.runMigrations();
  } catch (err) {
    console.error(`[Startup] Database initialization failed: ${err.message}`);
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  server = http.createServer(app);

  server.listen(port, () => {
    console.log(`[Server] EMS backend listening on port ${port} (${process.env.NODE_ENV || 'development'})`);

    // Real-time + ingestion start after the HTTP server is up.
    wsService.init(server);
    mqttService.init();
  });

  module.exports = app;
}

// --- Graceful shutdown ---
function shutdown(signal) {
  console.log(`[Server] ${signal} received — shutting down gracefully`);
  mqttService.close();
  wsService.close();
  if (server) {
    server.close(() => {
      db.pool.end().finally(() => {
        console.log('[Server] Closed. Bye.');
        process.exit(0);
      });
    });
    // Force-exit if connections linger.
    setTimeout(() => process.exit(1), 10000).unref();
  } else {
    db.pool.end().finally(() => process.exit(0));
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
