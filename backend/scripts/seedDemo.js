'use strict';

/**
 * Full-state demo seeder for the PMJ Fleet Dashboard.
 *
 * Populates the database so that EVERY dashboard feature and EVERY status value
 * renders as "working" — for screenshots, demos, and the project paper.
 *
 * It is idempotent: re-running wipes and re-creates the managed demo dataset
 * (the devices listed in DEVICES below, plus all their telemetry/alerts/frames).
 * It NEVER touches the users table or any device whose id is not in DEVICES.
 *
 *   node scripts/seedDemo.js          (from the backend/ directory)
 *   npm run seed:demo
 *
 * To remove all demo data and switch to real, connected devices, use the
 * companion script:  npm run cutover   (see scripts/cutover.js).
 *
 * Coverage matrix (see docs/DEMO_AND_PRODUCTION.md for the full table):
 *   device.status   : active, idle, anomaly
 *   engine_status   : running, idle, off
 *   GPS             : located + not-located (drives the map "X of Y located")
 *   camera          : online (stored frame) + offline (no frame)
 *   alert.severity  : high, medium, low (all active/unacknowledged)
 *   fuel chart      : drain curve, refuel step (event), theft drop (anomaly marker)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

// 24h of telemetry at a 5-minute cadence, ending "now".
const SAMPLES = 288;
const STEP_MS = 5 * 60 * 1000;

// Camera frame source: a real JPEG already in the repo, copied into the upload
// dir so the static /media/cameras mount serves it same-origin.
const FRAME_SOURCE = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'login-hero.jpg');
// Resolve relative to the backend root (scripts/..), matching how server.js
// resolves UPLOAD_DIR, so seeded frames land where the static mount serves them
// regardless of the current working directory.
const UPLOAD_DIR = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads/cameras');

// Pontianak-ish base coordinates for the live map.
const BASE_LAT = -0.0263;
const BASE_LON = 109.3425;

/**
 * The managed demo fleet. EXCAVATOR_001 is the real registered device (kept,
 * with its real token); the DEMO-* devices exist only to exercise the remaining
 * states and are removed wholesale by the cutover script.
 */
const DEVICES = [
  {
    // The real, registered device. `real: true` + null token means the seed
    // refreshes its telemetry/status but NEVER overwrites its real device_token
    // (so live MQTT auth keeps working). cutover keeps this device.
    device_id: 'EXCAVATOR_001', device_name: 'PMJ-01', operator_name: 'Manik',
    device_token: null, real: true, status: 'active', engine: 'running',
    gps: true, camera: true, curve: 'refuel',
  },
  {
    device_id: 'DEMO-EXC-02', device_name: 'PMJ-02', operator_name: 'Bayu',
    device_token: 'demo-token-02', status: 'idle', engine: 'idle',
    gps: true, camera: true, curve: 'gentle',
  },
  {
    device_id: 'DEMO-EXC-03', device_name: 'PMJ-03', operator_name: 'Sari',
    device_token: 'demo-token-03', status: 'anomaly', engine: 'running',
    gps: true, camera: false, curve: 'theft',
  },
  {
    device_id: 'DEMO-EXC-04', device_name: 'PMJ-04', operator_name: 'Joko',
    device_token: 'demo-token-04', status: 'active', engine: 'off',
    gps: true, camera: true, curve: 'flat-high',
  },
  {
    device_id: 'DEMO-EXC-05', device_name: 'PMJ-05', operator_name: 'Unassigned',
    device_token: 'demo-token-05', status: 'idle', engine: 'off',
    gps: false, camera: false, curve: 'flat-low',
  },
];

// Active, unacknowledged alerts spanning all three severities.
const ALERTS = [
  { device_id: 'DEMO-EXC-03', severity: 'high', type: 'fuel_anomaly', message: 'Fuel level below safe threshold', agoMin: 8 },
  { device_id: 'DEMO-EXC-03', severity: 'medium', type: 'fuel_anomaly', message: 'Sudden fuel drop detected', agoMin: 14 },
  { device_id: 'EXCAVATOR_001', severity: 'medium', type: 'fuel_anomaly', message: 'Low voltage detected', agoMin: 42 },
  { device_id: 'DEMO-EXC-04', severity: 'low', type: 'fuel_anomaly', message: 'Anomaly detected by ML model', agoMin: 95 },
];

const jitter = (amp) => (Math.random() * 2 - 1) * amp;

/**
 * Fuel level (litres, 600 L tank) for sample index i (0 = oldest, SAMPLES-1 =
 * newest). Each curve is shaped to make a specific feature visible.
 */
function fuelAt(curve, i) {
  let v;
  switch (curve) {
    case 'refuel': // steady burn with a refuel step (drives "Refuel events")
      v = 520 - i * 1.1 + (i >= 160 ? 300 : 0);
      break;
    case 'theft': // steady burn then a sharp drop (drives the red anomaly marker)
      v = 480 - i * 1.2 - (i >= 270 ? 80 : 0);
      break;
    case 'gentle': // slow drain while idling
      v = 300 - i * 0.15;
      break;
    case 'flat-high': // parked, tank full-ish
      v = 410 + jitter(3);
      break;
    case 'flat-low': // parked, low tank
      v = 150 + jitter(3);
      break;
    default:
      v = 300;
  }
  return Math.max(8, Math.min(600, Number((v + jitter(2)).toFixed(2))));
}

async function clearManaged(ids) {
  // alerts/fuel/gps/camera all FK to devices; delete children explicitly so the
  // script is safe even where ON DELETE CASCADE is not configured.
  for (const table of ['alerts', 'fuel_data', 'gps_data', 'camera_data']) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(`DELETE FROM ${table} WHERE device_id = ANY($1)`, [ids]);
  }
}

async function upsertDevice(d) {
  // COALESCE preserves any existing token when EXCLUDED.device_token is null
  // (real devices), so a demo reseed never breaks live MQTT authorization.
  await db.query(
    `INSERT INTO devices (device_id, device_name, status, operator_name, device_token, enabled)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (device_id) DO UPDATE
       SET device_name = EXCLUDED.device_name,
           status = EXCLUDED.status,
           operator_name = EXCLUDED.operator_name,
           device_token = COALESCE(EXCLUDED.device_token, devices.device_token),
           enabled = true`,
    [d.device_id, d.device_name, d.status, d.operator_name, d.device_token]
  );
}

async function seedTelemetry(d, now) {
  const fuelValues = [];
  const fuelParams = [];
  const gpsValues = [];
  const gpsParams = [];
  for (let i = 0; i < SAMPLES; i++) {
    const ts = new Date(now - (SAMPLES - 1 - i) * STEP_MS).toISOString();
    const fuel = fuelAt(d.curve, i);
    const voltage = Number((12.0 + Math.random() * 0.7).toFixed(2));
    const p = fuelParams.length;
    fuelValues.push(`($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5})`);
    fuelParams.push(d.device_id, fuel, d.engine, voltage, ts);

    if (d.gps) {
      const lat = Number((BASE_LAT + i * 0.000004 + jitter(0.00003)).toFixed(6));
      const lon = Number((BASE_LON + i * 0.000004 + jitter(0.00003)).toFixed(6));
      const g = gpsParams.length;
      gpsValues.push(`($${g + 1}, $${g + 2}, $${g + 3}, $${g + 4})`);
      gpsParams.push(d.device_id, lat, lon, ts);
    }
  }
  await db.query(
    `INSERT INTO fuel_data (device_id, fuel_level, engine_status, voltage, timestamp) VALUES ${fuelValues.join(',')}`,
    fuelParams
  );
  if (gpsValues.length) {
    await db.query(
      `INSERT INTO gps_data (device_id, latitude, longitude, timestamp) VALUES ${gpsValues.join(',')}`,
      gpsParams
    );
  }
}

async function seedCamera(d, now) {
  if (!d.camera) return; // no row => the Cameras page shows this device "Offline"
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const filename = `${d.device_id}_demo.jpg`;
  fs.copyFileSync(FRAME_SOURCE, path.join(UPLOAD_DIR, filename));
  await db.query(
    'INSERT INTO camera_data (device_id, image_path, timestamp) VALUES ($1, $2, $3)',
    [d.device_id, filename, new Date(now - 60 * 1000).toISOString()]
  );
}

async function seedAlerts(now) {
  for (const a of ALERTS) {
    const ts = new Date(now - a.agoMin * 60 * 1000).toISOString();
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      `INSERT INTO alerts (device_id, alert_type, alert_message, severity, status, timestamp)
       VALUES ($1, $2, $3, $4, 'active', $5)`,
      [a.device_id, a.type, a.message, a.severity, ts]
    );
  }
}

async function main() {
  const now = Date.now();
  const ids = DEVICES.map((d) => d.device_id);

  console.log('[seed] clearing managed demo data…');
  await clearManaged(ids);

  for (const d of DEVICES) {
    // eslint-disable-next-line no-await-in-loop
    await upsertDevice(d);
    // eslint-disable-next-line no-await-in-loop
    await seedTelemetry(d, now);
    // eslint-disable-next-line no-await-in-loop
    await seedCamera(d, now);
    console.log(`[seed] ${d.device_id.padEnd(14)} status=${d.status} engine=${d.engine} gps=${d.gps} camera=${d.camera} curve=${d.curve}`);
  }

  await seedAlerts(now);
  console.log(`[seed] ${ALERTS.length} active alerts (high/medium/low)`);

  const counts = await db.query(
    `SELECT
       (SELECT count(*) FROM devices) AS devices,
       (SELECT count(*) FROM fuel_data) AS fuel,
       (SELECT count(*) FROM gps_data) AS gps,
       (SELECT count(*) FROM camera_data) AS cameras,
       (SELECT count(*) FROM alerts WHERE status='active') AS active_alerts`
  );
  console.log('[seed] totals:', counts.rows[0]);
  console.log('[seed] done. Refresh the dashboard.');
  await db.pool.end();
}

main().catch((err) => {
  console.error('[seed] FAILED:', err.message);
  process.exit(1);
});
