'use strict';

const db = require('../db');

/**
 * Record a rejected device attempt in the audit log. Best-effort — a logging
 * failure must never break the caller.
 */
async function logRejection(deviceId, reason) {
  try {
    await db.query(
      'INSERT INTO audit_log (action, description) VALUES ($1, $2)',
      ['DEVICE_REJECTED', `${reason}: ${deviceId}`]
    );
  } catch (err) {
    console.error(`[DeviceAuth] Failed to write audit row: ${err.message}`);
  }
}

/**
 * Database-driven device authorization — the `devices` table is the single
 * source of truth (no hardcoded ids/tokens). Returns true only for a device
 * that exists, is enabled, and presents the matching token. Every rejection is
 * logged to console and the audit_log as DEVICE_REJECTED.
 *
 * Authorization gates on the `enabled` flag, NOT the live `status`
 * (idle/active/anomaly), so a device is never locked out by its own telemetry
 * state.
 */
async function validateDevice(deviceId, deviceToken) {
  const result = await db.query(
    'SELECT device_id, device_token, enabled FROM devices WHERE device_id = $1',
    [deviceId]
  );

  if (result.rows.length === 0) {
    console.warn(`[DeviceAuth] Unknown device rejected: ${deviceId}`);
    await logRejection(deviceId, 'Unknown device_id');
    return false;
  }

  const device = result.rows[0];

  if (device.enabled === false) {
    console.warn(`[DeviceAuth] Disabled device rejected: ${deviceId}`);
    await logRejection(deviceId, 'Disabled device');
    return false;
  }

  if (!device.device_token || device.device_token !== deviceToken) {
    console.warn(`[DeviceAuth] Invalid token rejected: ${deviceId}`);
    await logRejection(deviceId, 'Invalid token for device');
    return false;
  }

  return true;
}

module.exports = { validateDevice };
