'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const wsService = require('../services/wsService');
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
    return res.json({
      image_id: row.image_id,
      image_url: `/media/cameras/${path.basename(row.image_path)}`,
      timestamp: row.timestamp
    });
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
