'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const wsService = require('../services/wsService');
const mqttService = require('../services/mqttService');
const { validateDevice } = require('../services/deviceAuth');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads/cameras';
const MAX_IMAGE_SIZE_MB = parseInt(process.env.MAX_IMAGE_SIZE_MB || '15', 10);

// Ensure the upload directory exists at runtime (it is gitignored).
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeId = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${safeId}_${Date.now()}_${unique}.jpg`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg') {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG images are accepted'));
    }
  }
});

/**
 * GET /api/devices
 * All devices with their latest fuel reading and latest GPS fix joined.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         d.device_id,
         d.device_name,
         d.status,
         d.operator_name,
         d.camera_paused,
         f.fuel_level,
         f.voltage,
         f.engine_status,
         g.latitude,
         g.longitude,
         GREATEST(
           COALESCE(f.timestamp, 'epoch'::timestamp),
           COALESCE(g.timestamp, 'epoch'::timestamp)
         ) AS last_updated
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT fuel_level, voltage, engine_status, timestamp
         FROM fuel_data
         WHERE device_id = d.device_id
         ORDER BY timestamp DESC
         LIMIT 1
       ) f ON true
       LEFT JOIN LATERAL (
         SELECT latitude, longitude, timestamp
         FROM gps_data
         WHERE device_id = d.device_id
         ORDER BY timestamp DESC
         LIMIT 1
       ) g ON true
       ORDER BY d.device_id`
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

function resolveRange(req) {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const start = req.query.start ? new Date(req.query.start) : defaultStart;
  const end = req.query.end ? new Date(req.query.end) : now;
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * GET /api/devices/:id/fuel?start=&end=
 */
router.get('/:id/fuel', requireAuth, async (req, res, next) => {
  try {
    const { start, end } = resolveRange(req);
    const result = await db.query(
      `SELECT fuel_id, fuel_level, engine_status, voltage, timestamp
       FROM fuel_data
       WHERE device_id = $1 AND timestamp >= $2 AND timestamp <= $3
       ORDER BY timestamp ASC`,
      [req.params.id, start, end]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/devices/:id/gps?start=&end=
 */
router.get('/:id/gps', requireAuth, async (req, res, next) => {
  try {
    const { start, end } = resolveRange(req);
    const result = await db.query(
      `SELECT gps_id, latitude, longitude, timestamp
       FROM gps_data
       WHERE device_id = $1 AND timestamp >= $2 AND timestamp <= $3
       ORDER BY timestamp ASC`,
      [req.params.id, start, end]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/devices/:id/camera/stream
 * Deprecated. The ESP32-CAM no longer serves a reachable HTTP/MJPEG stream — it
 * sits behind NAT/CGNAT. Cameras now publish periodic base64 JPEG snapshots over
 * MQTT (device/{id}/camera), so clients should poll GET /:id/camera/latest.
 */
router.get('/:id/camera/stream', requireAuth, (req, res) => {
  return res.status(410).json({
    error: 'Live stream proxy is deprecated. Cameras now publish periodic snapshots via MQTT — use GET /:id/camera/latest instead.'
  });
});

/**
 * GET /api/devices/:id/camera/latest
 */
router.get('/:id/camera/latest', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT image_id, image_path, timestamp
       FROM camera_data
       WHERE device_id = $1
       ORDER BY timestamp DESC
       LIMIT 1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No camera image for this device' });
    }
    const row = result.rows[0];
    // image_path is either an absolute live-stream URL (MQTT path, e.g.
    // http://<cam-ip>/stream) or a stored snapshot filename (upload path).
    const isAbsolute = /^https?:\/\//i.test(row.image_path);
    return res.json({
      image_id: row.image_id,
      image_url: isAbsolute ? row.image_path : `/media/cameras/${path.basename(row.image_path)}`,
      timestamp: row.timestamp
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/devices/:id/camera/control
 * Body: { action: "pause" | "resume" }
 * Publishes an MQTT command to the device and updates camera_paused state.
 * Open to all authenticated roles (admin, operator, viewer) — no role restriction.
 */
router.post('/:id/camera/control', requireAuth, async (req, res, next) => {
  try {
    const { action } = req.body;
    if (action !== 'pause' && action !== 'resume') {
      return res.status(400).json({ error: 'action must be "pause" or "resume"' });
    }

    const deviceId = req.params.id;

    // Confirm device exists before publishing/updating.
    const deviceCheck = await db.query(
      'SELECT device_id FROM devices WHERE device_id = $1',
      [deviceId]
    );
    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const paused = action === 'pause';

    await db.query(
      'UPDATE devices SET camera_paused = $1 WHERE device_id = $2',
      [paused, deviceId]
    );

    // Publish control command via MQTT (optimistic — no device ack expected).
    mqttService.publishCameraControl(deviceId, action);

    // Log this action for audit purposes.
    await db.query(
      `INSERT INTO audit_log (user_id, action, description) VALUES ($1, $2, $3)`,
      [req.user.user_id, `CAMERA_${action.toUpperCase()}`, `Camera ${action} requested for device ${deviceId}`]
    );

    // Broadcast to connected dashboards so all open sessions reflect the new state.
    wsService.broadcast('camera_control', { device_id: deviceId, camera_paused: paused });

    return res.json({ device_id: deviceId, camera_paused: paused });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/devices/:id/camera/heartbeat
 * Called periodically by the frontend while a user has the Cameras page open
 * and a given device tile/modal visible. Upserts last_viewed_at to "now".
 * Open to all authenticated roles — viewing activity from any role counts.
 */
router.post('/:id/camera/heartbeat', requireAuth, async (req, res, next) => {
  try {
    const deviceId = req.params.id;
    await db.query(
      `INSERT INTO camera_view_heartbeats (device_id, last_viewed_at)
       VALUES ($1, NOW())
       ON CONFLICT (device_id) DO UPDATE SET last_viewed_at = NOW()`,
      [deviceId]
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/devices/:id/camera/upload
 * Authenticated by the Device-Token header (matched against devices table).
 * Accepts a single multipart field named `image` that must be a JPEG.
 */
router.post(
  '/:id/camera/upload',
  async (req, res, next) => {
    // Device authorization before accepting the upload — same DB-driven gate as
    // MQTT telemetry (existence, enabled, token), with DEVICE_REJECTED auditing.
    try {
      const token = req.headers['device-token'];
      if (!token) {
        return res.status(401).json({ error: 'Missing Device-Token header' });
      }
      const authorized = await validateDevice(req.params.id, token);
      if (!authorized) {
        return res.status(403).json({ error: 'Invalid device credentials' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  },
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded' });
      }
      const result = await db.query(
        `INSERT INTO camera_data (device_id, image_path) VALUES ($1, $2)
         RETURNING image_id, timestamp`,
        [req.params.id, req.file.filename]
      );
      const row = result.rows[0];
      const imageUrl = `/media/cameras/${req.file.filename}`;

      wsService.broadcast('camera_frame', {
        device_id: req.params.id,
        image_url: imageUrl,
        timestamp: row.timestamp
      });

      return res.status(201).json({ status: 'stored', image_id: row.image_id });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
