'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/alerts?status=&device_id=
 * Defaults to active alerts. Ordered by severity (high first), then newest.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const status = req.query.status || 'active';
    const deviceId = req.query.device_id || null;

    const result = await db.query(
      `SELECT
         a.alert_id, a.device_id, a.alert_type, a.alert_message,
         a.severity, a.status, a.timestamp,
         d.device_name
       FROM alerts a
       LEFT JOIN devices d ON d.device_id = a.device_id
       WHERE a.status = $1
         AND ($2::varchar IS NULL OR a.device_id = $2)
       ORDER BY
         CASE a.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
         a.timestamp DESC`,
      [status, deviceId]
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /api/alerts/:id/acknowledge
 * Admin/Supervisor only. Marks an alert acknowledged and writes an audit row.
 */
router.put('/:id/acknowledge', requireRole('admin', 'supervisor'), async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE alerts SET status = 'acknowledged'
       WHERE alert_id = $1 AND status = 'active'
       RETURNING alert_id, device_id`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Alert not found or already acknowledged' });
    }

    const { alert_id, device_id } = result.rows[0];
    await db.query(
      'INSERT INTO audit_log (user_id, action, description) VALUES ($1, $2, $3)',
      [
        req.user.user_id,
        'ALERT_ACKNOWLEDGED',
        `Alert ${alert_id} on device ${device_id} acknowledged by ${req.user.username}`
      ]
    );

    return res.json({ status: 'ACKNOWLEDGED' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
