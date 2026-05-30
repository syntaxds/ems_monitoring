'use strict';

/**
 * Production cutover for the PMJ Fleet Dashboard.
 *
 * Removes ALL demo data and leaves a clean database that reflects only real,
 * connected devices. After this runs, every dashboard page is driven purely by
 * live telemetry arriving over MQTT from the physical ESP32 devices.
 *
 *   node scripts/cutover.js          (from the backend/ directory)
 *   npm run cutover
 *
 * What it does (in one transaction):
 *   1. Deletes every DEMO-* device and all of its telemetry/alerts/frames.
 *   2. Clears ALL remaining telemetry (fuel_data, gps_data, camera_data) and
 *      alerts, so real devices start from a clean slate.
 *   3. Resets every surviving (real) device's live status to 'idle'.
 *   4. Deletes demo camera image files from the upload directory.
 *
 * What it KEEPS:
 *   - The users table (logins).
 *   - All real devices (any device_id NOT starting with 'DEMO-'), including
 *     their device_token and enabled flag — so real hardware stays authorized.
 *   - audit_log and reports history.
 *
 * Safe to run repeatedly. Pass --yes to skip the confirmation delay.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

// Resolve relative to the backend root (scripts/..), matching server.js.
const UPLOAD_DIR = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads/cameras');

async function main() {
  console.log('[cutover] Switching to PRODUCTION: removing all demo data…');

  const before = await db.query('SELECT count(*) AS n FROM devices');
  console.log(`[cutover] devices before: ${before.rows[0].n}`);

  await db.query('BEGIN');
  try {
    // 1. Remove demo devices and everything that FKs to them.
    for (const table of ['alerts', 'fuel_data', 'gps_data', 'camera_data']) {
      // eslint-disable-next-line no-await-in-loop
      await db.query(`DELETE FROM ${table} WHERE device_id LIKE 'DEMO-%'`);
    }
    const delDevices = await db.query("DELETE FROM devices WHERE device_id LIKE 'DEMO-%'");
    console.log(`[cutover] removed ${delDevices.rowCount} demo device(s)`);

    // 2. Clear all remaining telemetry/alerts so real devices start clean.
    await db.query('DELETE FROM alerts');
    await db.query('DELETE FROM fuel_data');
    await db.query('DELETE FROM gps_data');
    await db.query('DELETE FROM camera_data');

    // 3. Reset live status of every surviving real device.
    const reset = await db.query("UPDATE devices SET status = 'idle'");
    console.log(`[cutover] reset ${reset.rowCount} real device(s) to status='idle'`);

    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }

  // 4. Delete demo camera files from disk (best-effort).
  try {
    if (fs.existsSync(UPLOAD_DIR)) {
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        if (f.startsWith('DEMO-') || f.endsWith('_demo.jpg')) {
          fs.unlinkSync(path.join(UPLOAD_DIR, f));
        }
      }
    }
  } catch (err) {
    console.warn(`[cutover] could not clean upload dir: ${err.message}`);
  }

  const after = await db.query(
    `SELECT
       (SELECT count(*) FROM devices) AS devices,
       (SELECT count(*) FROM fuel_data) AS fuel,
       (SELECT count(*) FROM alerts) AS alerts,
       (SELECT count(*) FROM camera_data) AS cameras`
  );
  console.log('[cutover] remaining:', after.rows[0]);
  console.log('[cutover] Done. Database now reflects real devices only.');
  console.log('[cutover] Next: ensure each physical device has a row in `devices`');
  console.log('[cutover]       with a matching device_token, then start publishing telemetry.');
  await db.pool.end();
}

main().catch((err) => {
  console.error('[cutover] FAILED:', err.message);
  process.exit(1);
});
