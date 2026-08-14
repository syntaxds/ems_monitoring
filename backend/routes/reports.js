'use strict';

const express = require('express');
const db = require('../db');
const { requireRoleExcluding } = require('../middleware/auth');
const { generateCSV, generatePDF } = require('../services/reportService');

const router = express.Router();

/**
 * POST /api/reports/generate
 * Body: { device_id?, start_date, end_date, format }
 * Streams a CSV or PDF report. If device_id is omitted/empty, the report
 * covers the whole fleet. The file is streamed, never written to disk.
 */
router.post('/generate', requireRoleExcluding('driver'), async (req, res, next) => {
  try {
    const { device_id, start_date, end_date, format } = req.body || {};

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }
    if (!['csv', 'pdf'].includes(format)) {
      return res.status(400).json({ error: "format must be 'csv' or 'pdf'" });
    }

    const startDate = new Date(start_date);
    const endDay = new Date(end_date);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDay.getTime())) {
      return res.status(400).json({ error: 'start_date and end_date must be valid dates' });
    }
    const start = startDate.toISOString();
    // Include the whole end day.
    endDay.setHours(23, 59, 59, 999);
    const end = endDay.toISOString();

    const deviceFilter = device_id ? device_id : null;

    // Devices in scope, with their latest reading and whether an anomaly
    // alert was raised within the range.
    const deviceRows = (
      await db.query(
        `SELECT
           d.device_id, d.device_name, d.operator_name, d.status,
           f.fuel_level, f.voltage,
           EXISTS (
             SELECT 1 FROM alerts a
             WHERE a.device_id = d.device_id
               AND a.alert_type = 'fuel_anomaly'
               AND a.timestamp >= $2 AND a.timestamp <= $3
           ) AS anomaly_in_range
         FROM devices d
         LEFT JOIN LATERAL (
           SELECT fuel_level, voltage FROM fuel_data
           WHERE device_id = d.device_id AND timestamp <= $3
           ORDER BY timestamp DESC LIMIT 1
         ) f ON true
         WHERE ($1::varchar IS NULL OR d.device_id = $1)
         ORDER BY d.device_id`,
        [deviceFilter, start, end]
      )
    ).rows;

    // Fleet summary counts.
    const summary = {
      total: deviceRows.length,
      active: deviceRows.filter((d) => d.status === 'active').length,
      idle: deviceRows.filter((d) => d.status === 'idle').length,
      anomalies: deviceRows.filter((d) => d.status === 'anomaly').length
    };

    // Detailed time-series rows for CSV.
    const fuelRows = (
      await db.query(
        `SELECT f.device_id, d.device_name, f.fuel_level, f.engine_status,
                f.voltage, f.timestamp
         FROM fuel_data f
         LEFT JOIN devices d ON d.device_id = f.device_id
         WHERE ($1::varchar IS NULL OR f.device_id = $1)
           AND f.timestamp >= $2 AND f.timestamp <= $3
         ORDER BY f.device_id, f.timestamp ASC`,
        [deviceFilter, start, end]
      )
    ).rows;

    // Record the report in the reports table.
    await db.query(
      `INSERT INTO reports (user_id, start_date, end_date, format)
       VALUES ($1, $2, $3, $4)`,
      [req.user.user_id, start_date, end_date, format]
    );

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    if (format === 'csv') {
      const csvRows = fuelRows.map((r) => ({
        device_id: r.device_id,
        device_name: r.device_name,
        fuel_level: r.fuel_level,
        engine_status: r.engine_status,
        voltage: r.voltage,
        timestamp: new Date(r.timestamp).toISOString()
      }));
      const csv = generateCSV(csvRows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ems_report_${stamp}.csv"`);
      return res.send(csv);
    }

    // PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ems_report_${stamp}.pdf"`);

    const meta = {
      dateRange: `${start_date} to ${end_date}`,
      generatedBy: req.user.username,
      generatedAt: new Date().toISOString()
    };

    const detail = deviceRows.map((d) => ({
      device_id: d.device_id,
      device_name: d.device_name,
      operator_name: d.operator_name,
      status: d.status,
      fuel_level: d.fuel_level,
      voltage: d.voltage,
      anomaly: d.anomaly_in_range ? 'Yes' : 'No'
    }));

    return generatePDF(res, 'Excavator Monitoring Report', meta, summary, detail);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
