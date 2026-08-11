'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireRole, requireRoleExcluding } = require('../middleware/auth');
const { generateCSV, generateShiftLogPDF } = require('../services/reportService');

const router = express.Router();

const UPLOAD_DIR = process.env.SHIFT_LOG_UPLOAD_DIR || './uploads/shift-logs';
const MAX_IMAGE_SIZE_MB = parseInt(process.env.MAX_IMAGE_SIZE_MB || '15', 10);

// Ensure the upload directory exists at runtime (it is gitignored).
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `shift_${Date.now()}_${unique}.jpg`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/jpeg') {
      cb(null, true);
    } else {
      const err = new Error('Only JPEG images are accepted');
      err.status = 400;
      cb(err);
    }
  }
});

async function auditShiftLog(userId, action, description) {
  try {
    await db.query(
      'INSERT INTO audit_log (user_id, action, description) VALUES ($1, $2, $3)',
      [userId, action, description]
    );
  } catch (err) {
    console.error(`[Audit] Failed to write ${action}: ${err.message}`);
  }
}

/**
 * GET /api/driver-shift-logs/available-units
 * Devices with no currently-active shift claim. Driver-only — this feeds the
 * shift start dropdown. A unit reappears here the moment its holder ends
 * their shift, regardless of date.
 */
router.get('/available-units', requireRole('driver'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT d.device_id, d.device_name
       FROM devices d
       WHERE NOT EXISTS (
         SELECT 1 FROM driver_shift_logs l
         WHERE l.device_id = d.device_id AND l.status = 'active'
       )
       ORDER BY d.device_id`
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/driver-shift-logs/active
 * The calling driver's current active shift, if any (at most one — enforced
 * by uq_driver_shift_logs_active_driver). Lets the Shift Start page decide
 * whether to render the start form or the end form.
 */
router.get('/active', requireRole('driver'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT l.log_id, l.device_id, d.device_name, l.shift_date, l.start_time,
              l.fuel_initial, l.hour_meter, l.photo_path
       FROM driver_shift_logs l
       JOIN devices d ON d.device_id = l.device_id
       WHERE l.driver_user_id = $1 AND l.status = 'active'
       LIMIT 1`,
      [req.user.user_id]
    );
    if (result.rowCount === 0) {
      return res.json(null);
    }
    const row = result.rows[0];
    return res.json({ ...row, photo_url: `/media/shift-logs/${path.basename(row.photo_path)}` });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/driver-shift-logs
 * Multipart: device_id, start_time, fuel_initial, hour_meter, photo (JPEG).
 * shift_date is always CURRENT_DATE server-side, never trusted from the
 * client. Two partial unique indexes are the real source of truth — one
 * active shift per device, one active shift per driver — so a race between
 * simultaneous submissions can never create two active rows for the same
 * unit or the same driver.
 */
router.post('/', requireRole('driver'), upload.single('photo'), async (req, res, next) => {
  const cleanupUpload = () => {
    if (req.file) fs.unlink(req.file.path, () => {});
  };

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Photo proof (JPEG) is required' });
    }

    const { device_id, start_time, fuel_initial, hour_meter } = req.body || {};
    if (!device_id || !start_time) {
      cleanupUpload();
      return res.status(400).json({ error: 'device_id and start_time are required' });
    }

    const fuel = Number(fuel_initial);
    if (!Number.isFinite(fuel) || fuel <= 0) {
      cleanupUpload();
      return res.status(400).json({ error: 'fuel_initial must be a positive number' });
    }

    const hourMeter = Number(hour_meter);
    if (!Number.isFinite(hourMeter) || hourMeter <= 0) {
      cleanupUpload();
      return res.status(400).json({ error: 'hour_meter must be a positive number' });
    }

    const startDate = new Date(start_time);
    if (Number.isNaN(startDate.getTime())) {
      cleanupUpload();
      return res.status(400).json({ error: 'start_time must be a valid date/time' });
    }

    const deviceCheck = await db.query('SELECT device_id FROM devices WHERE device_id = $1', [device_id]);
    if (deviceCheck.rowCount === 0) {
      cleanupUpload();
      return res.status(400).json({ error: 'device_id is not a valid device' });
    }

    let result;
    try {
      result = await db.query(
        `INSERT INTO driver_shift_logs
           (driver_user_id, device_id, shift_date, start_time, fuel_initial, hour_meter, photo_path)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)
         RETURNING log_id, device_id, shift_date, start_time, fuel_initial, hour_meter, photo_path, status, created_at`,
        [req.user.user_id, device_id, startDate.toISOString(), fuel, hourMeter, req.file.filename]
      );
    } catch (e) {
      if (e.code === '23505') {
        cleanupUpload();
        if (e.constraint === 'uq_driver_shift_logs_active_driver') {
          return res.status(409).json({ error: 'You already have an active shift. End it before starting a new one.' });
        }
        return res.status(409).json({ error: 'Unit already claimed by another driver' });
      }
      throw e;
    }

    await auditShiftLog(
      req.user.user_id,
      'SHIFT_LOG_CREATED',
      `Driver "${req.user.username}" started shift on device ${device_id}`
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    cleanupUpload();
    return next(err);
  }
});

/**
 * POST /api/driver-shift-logs/end
 * Multipart: end_time, fuel_final, hour_meter_final, photo (JPEG).
 * Closes out the calling driver's active shift (there can be at most one —
 * uq_driver_shift_logs_active_driver). This always operates on the existing
 * active row — it never creates a new row — so a second start/end cycle on
 * the same unit the same day produces a separate row from the first.
 */
router.post('/end', requireRole('driver'), upload.single('photo'), async (req, res, next) => {
  const cleanupUpload = () => {
    if (req.file) fs.unlink(req.file.path, () => {});
  };

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Photo proof (JPEG) is required' });
    }

    const { end_time, fuel_final, hour_meter_final } = req.body || {};
    if (!end_time) {
      cleanupUpload();
      return res.status(400).json({ error: 'end_time is required' });
    }

    const fuel = Number(fuel_final);
    if (!Number.isFinite(fuel) || fuel <= 0) {
      cleanupUpload();
      return res.status(400).json({ error: 'fuel_final must be a positive number' });
    }

    const hourMeter = Number(hour_meter_final);
    if (!Number.isFinite(hourMeter) || hourMeter <= 0) {
      cleanupUpload();
      return res.status(400).json({ error: 'hour_meter_final must be a positive number' });
    }

    const endDate = new Date(end_time);
    if (Number.isNaN(endDate.getTime())) {
      cleanupUpload();
      return res.status(400).json({ error: 'end_time must be a valid date/time' });
    }

    const active = await db.query(
      `SELECT log_id, device_id FROM driver_shift_logs WHERE driver_user_id = $1 AND status = 'active' LIMIT 1`,
      [req.user.user_id]
    );
    if (active.rowCount === 0) {
      cleanupUpload();
      return res.status(404).json({ error: 'No active shift to end' });
    }

    const result = await db.query(
      `UPDATE driver_shift_logs
       SET status = 'completed', end_time = $1, fuel_final = $2, hour_meter_final = $3, end_photo_path = $4
       WHERE log_id = $5
       RETURNING log_id, device_id, shift_date, start_time, end_time, fuel_initial, fuel_final,
                 hour_meter, hour_meter_final, photo_path, end_photo_path, status, created_at`,
      [endDate.toISOString(), fuel, hourMeter, req.file.filename, active.rows[0].log_id]
    );

    await auditShiftLog(
      req.user.user_id,
      'SHIFT_LOG_ENDED',
      `Driver "${req.user.username}" ended shift on device ${active.rows[0].device_id}`
    );

    return res.json(result.rows[0]);
  } catch (err) {
    cleanupUpload();
    return next(err);
  }
});

/**
 * GET /api/driver-shift-logs
 * Full shift log list for the Driver Logs page. Every role EXCEPT driver can
 * view this — inverse of the usual requireRole.
 */
router.get('/', requireRoleExcluding('driver'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT l.log_id, l.device_id, d.device_name, u.username AS driver_name,
              l.shift_date, l.start_time, l.end_time, l.status,
              l.fuel_initial, l.fuel_final, l.hour_meter, l.hour_meter_final,
              l.photo_path, l.end_photo_path, l.created_at
       FROM driver_shift_logs l
       JOIN users u ON u.user_id = l.driver_user_id
       JOIN devices d ON d.device_id = l.device_id
       ORDER BY l.shift_date DESC, l.start_time DESC`
    );
    const rows = result.rows.map((r) => ({
      ...r,
      photo_url: `/media/shift-logs/${path.basename(r.photo_path)}`,
      end_photo_url: r.end_photo_path ? `/media/shift-logs/${path.basename(r.end_photo_path)}` : null
    }));
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/driver-shift-logs/export
 * Body: { start_date, end_date, format }
 * Streams a CSV or PDF of shift logs within the date range. Same
 * access rule as the Driver Logs page — every role except driver.
 */
router.post('/export', requireRoleExcluding('driver'), async (req, res, next) => {
  try {
    const { start_date, end_date, format } = req.body || {};

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }
    if (!['csv', 'pdf'].includes(format)) {
      return res.status(400).json({ error: "format must be 'csv' or 'pdf'" });
    }
    if (Number.isNaN(new Date(start_date).getTime()) || Number.isNaN(new Date(end_date).getTime())) {
      return res.status(400).json({ error: 'start_date and end_date must be valid dates' });
    }

    const rows = (
      await db.query(
        `SELECT l.log_id, l.device_id, d.device_name, u.username AS driver_name,
                l.shift_date, l.start_time, l.end_time, l.status,
                l.fuel_initial, l.fuel_final, l.hour_meter, l.hour_meter_final, l.created_at
         FROM driver_shift_logs l
         JOIN users u ON u.user_id = l.driver_user_id
         JOIN devices d ON d.device_id = l.device_id
         WHERE l.shift_date >= $1 AND l.shift_date <= $2
         ORDER BY l.shift_date ASC, l.start_time ASC`,
        [start_date, end_date]
      )
    ).rows;

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    if (format === 'csv') {
      const csvRows = rows.map((r) => ({
        driver_name: r.driver_name,
        device_id: r.device_id,
        device_name: r.device_name,
        status: r.status,
        shift_date: new Date(r.shift_date).toISOString().slice(0, 10),
        start_time: new Date(r.start_time).toISOString(),
        end_time: r.end_time ? new Date(r.end_time).toISOString() : '',
        fuel_initial: r.fuel_initial,
        fuel_final: r.fuel_final != null ? r.fuel_final : '',
        hour_meter: r.hour_meter,
        hour_meter_final: r.hour_meter_final != null ? r.hour_meter_final : ''
      }));
      const csv = generateCSV(csvRows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="driver_shift_logs_${stamp}.csv"`);
      return res.send(csv);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="driver_shift_logs_${stamp}.pdf"`);

    const meta = {
      dateRange: `${start_date} to ${end_date}`,
      generatedBy: req.user.username,
      generatedAt: new Date().toISOString()
    };

    return generateShiftLogPDF(res, 'Driver Shift Logs Report', meta, rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
