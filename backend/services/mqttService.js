'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mqtt = require('mqtt');
const db = require('../db');
const aiService = require('./aiService');
const wsService = require('./wsService');
const { validateDevice } = require('./deviceAuth');

const TELEMETRY_TOPIC = 'device/+/telemetry';
const STATUS_TOPIC = 'device/+/status';
const CAMERA_TOPIC = 'device/+/camera';
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000; // cap the exponential backoff; never stop retrying

let client = null;
let retryCount = 0;
let reconnectTimer = null;
let stopped = false;

const severityMap = { 1: 'low', 2: 'medium', 3: 'high' };

/**
 * Build MQTT connection options for HiveMQ Cloud.
 * Uses username/password auth over TLS — no client certificates required.
 */
function buildConnectOptions() {
  return {
    host: process.env.MQTT_HOST,
    port: parseInt(process.env.MQTT_PORT || '8883'),
    protocol: 'mqtts',
    username: process.env.MQTT_USER || '',
    password: process.env.MQTT_PASS || '',
    rejectUnauthorized: false, // set true in production with proper CA cert
    protocolVersion: 4,
    reconnectPeriod: 0, // manual backoff
    connectTimeout: 10000
  };
}

/**
 * Connect to HiveMQ Cloud broker over TLS and subscribe to telemetry
 * and status topics. If MQTT_HOST is not configured, stays idle without
 * crashing the process.
 */
function init() {
  if (!process.env.MQTT_HOST) {
    console.warn('[MQTT] MQTT_HOST not set — MQTT ingestion disabled. Telemetry over MQTT will not be received.');
    return;
  }

  if (!process.env.MQTT_USER || !process.env.MQTT_PASS) {
    console.warn('[MQTT] MQTT_USER or MQTT_PASS not set — connection may be rejected by broker.');
  }

  const options = buildConnectOptions();
  const url = `mqtts://${options.host}:${options.port}`;
  console.log(`[MQTT] Connecting to ${url} as '${options.username}' ...`);

  client = mqtt.connect(url, options);

  client.on('connect', () => {
    retryCount = 0;
    console.log('[MQTT] Connected to broker');
    client.subscribe([TELEMETRY_TOPIC, STATUS_TOPIC, CAMERA_TOPIC], { qos: 1 }, (err) => {
      if (err) {
        console.error(`[MQTT] Subscription failed: ${err.message}`);
      } else {
        console.log(`[MQTT] Subscribed to ${TELEMETRY_TOPIC}, ${STATUS_TOPIC} and ${CAMERA_TOPIC}`);
      }
    });
  });

  client.on('message', (topic, payload) => {
    handleMessage(topic, payload).catch((err) => {
      console.error(`[MQTT] Error handling message on ${topic}: ${err.message}`);
    });
  });

  client.on('error', (err) => {
    console.error(`[MQTT] Connection error: ${err.message}`);
  });

  client.on('close', () => {
    if (stopped) return;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  // Cap the backoff but never give up — telemetry ingestion must self-heal after
  // a broker/network outage without a manual process restart. retryCount resets
  // to 0 in the 'connect' handler once a stable connection is re-established.
  const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, retryCount), MAX_BACKOFF_MS);
  retryCount += 1;
  console.warn(`[MQTT] Disconnected. Reconnect attempt ${retryCount} in ${delay}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    try {
      if (client) client.end(true);
    } catch (_) {
      // ignore
    }
    init();
  }, delay);
}

/**
 * Extract the device_id segment from a topic of form device/{id}/{kind}.
 */
function deviceIdFromTopic(topic) {
  const parts = topic.split('/');
  return parts.length >= 2 ? parts[1] : null;
}

async function handleMessage(topic, payloadBuffer) {
  let data;
  try {
    data = JSON.parse(payloadBuffer.toString());
  } catch (err) {
    console.warn(`[MQTT] Invalid JSON on ${topic} — discarded`);
    return;
  }

  const deviceId = deviceIdFromTopic(topic);
  if (!deviceId) {
    console.warn(`[MQTT] Could not parse device id from topic ${topic}`);
    return;
  }

  if (topic.endsWith('/telemetry')) {
    await handleTelemetry(deviceId, data);
  } else if (topic.endsWith('/status')) {
    handleStatus(deviceId, data);
  } else if (topic.endsWith('/camera')) {
    await handleCameraFrame(deviceId, data);
  }
}

async function handleTelemetry(deviceId, data) {
  // 1. Authorize device against DB (existence, enabled flag, token match).
  //    Gates on `enabled` column — not live `status` — so anomaly/idle devices
  //    are never locked out by their own telemetry state.
  const authorized = await validateDevice(deviceId, data.device_token);
  if (!authorized) return;

  const timestamp = data.timestamp || new Date().toISOString();
  const fuelLevel = Number(data.fuel_level);
  // AI engine expects fuel_level as percentage (0-100). Firmware publishes
  // fuel_pct separately; fall back to fuel_level only if pct is absent.
  const fuelPctForAi = data.fuel_pct != null ? Number(data.fuel_pct) : fuelLevel;
  const engineStatus = data.engine_status || null;
  // The AI engine compares engine_status against uppercase "OFF"/"ON", but
  // firmware sends lowercase "off"/"running". Normalize ONLY for the AI call so
  // the engine-off fuel-drop rule actually fires; the original casing is still
  // what we persist to fuel_data below.
  const engineStatusForAi = engineStatus ? String(engineStatus).toUpperCase() : null;
  const voltage = data.voltage != null ? Number(data.voltage) : null;

  // 2. Insert fuel telemetry.
  await db.query(
    `INSERT INTO fuel_data (device_id, fuel_level, engine_status, voltage, timestamp)
     VALUES ($1, $2, $3, $4, $5)`,
    [deviceId, fuelLevel, engineStatus, voltage, timestamp]
  );

  // 3. Insert GPS reading if present.
  if (data.latitude != null && data.longitude != null) {
    await db.query(
      `INSERT INTO gps_data (device_id, latitude, longitude, timestamp)
       VALUES ($1, $2, $3, $4)`,
      [deviceId, Number(data.latitude), Number(data.longitude), timestamp]
    );
  }

  // 4. Handle camera stream URL if present (optional — only sent when CAM IP is known).
  //    stream_url is the local IP stream served by ESP32-CAM HTTP server.
  //    Note: this URL is only reachable if the dashboard client is on the same
  //    local network as the camera. This is a known limitation of the current
  //    camera architecture.
  if (data.stream_url) {
    await db.query(
      `INSERT INTO camera_data (device_id, image_path, timestamp)
       VALUES ($1, $2, $3)`,
      [deviceId, data.stream_url, timestamp]
    );
    wsService.broadcast('camera_frame', {
      device_id: deviceId,
      image_url: data.stream_url,
      cam_ip: data.cam_ip || null,
      mdns_url: data.mdns_url || null,
      timestamp
    });
  }

  // 5. Mark device active.
  await db.query(
    `UPDATE devices SET status = 'active' WHERE device_id = $1`,
    [deviceId]
  );

  // 6. Run anomaly analysis (fail-safe — never throws, returns fallback on error).
  //    voltage/engine_status are forwarded so the engine's low-voltage and
  //    engine-off fuel-drop rules can fire (null when absent — engine defaults).
  const aiResult = await aiService.analyze(deviceId, fuelPctForAi, timestamp, voltage, engineStatusForAi);

  // 7. Create alert and flag device if anomaly detected.
  //    Debounce: only ONE active alert per (device_id, alert_type) is kept. A
  //    device stuck in an anomalous state publishes every ~15s, so without this
  //    the table accumulates a duplicate row per message. ON CONFLICT against the
  //    partial unique index (uq_alerts_active_per_device_type) makes this atomic
  //    and race-safe — a duplicate inserts nothing and returns no row, so we only
  //    broadcast alert_new on the normal→anomaly transition.
  if (aiResult.anomaly === true) {
    const severity = severityMap[aiResult.severity_code] || 'medium';
    const message = aiResult.reason || 'Anomaly detected by ML model';

    const inserted = await db.query(
      `INSERT INTO alerts (device_id, alert_type, alert_message, severity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_id, alert_type) WHERE status = 'active' DO NOTHING
       RETURNING alert_id`,
      [deviceId, 'fuel_anomaly', message, severity]
    );

    // Keep the device flagged anomalous regardless (idempotent re-assert).
    await db.query(
      `UPDATE devices SET status = 'anomaly' WHERE device_id = $1`,
      [deviceId]
    );

    // Only broadcast when a genuinely new alert was created (not a duplicate).
    // With RETURNING, a suppressed ON CONFLICT insert yields zero rows.
    if (inserted.rows.length > 0) {
      wsService.broadcast('alert_new', {
        alert_id: inserted.rows[0].alert_id,
        device_id: deviceId,
        alert_type: 'fuel_anomaly',
        alert_message: message,
        severity,
        risk_level: aiResult.risk_level,
        anomaly_score: aiResult.anomaly_score,
        timestamp
      });
    }
  }

  // 8. Push live telemetry update to all connected dashboard clients.
  wsService.broadcast('fuel_update', {
    device_id: deviceId,
    fuel_level: fuelLevel,
    engine_status: engineStatus,
    voltage,
    timestamp
  });

  // 9. Push GPS update if coordinates were present.
  if (data.latitude != null && data.longitude != null) {
    wsService.broadcast('gps_update', {
      device_id: deviceId,
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      timestamp
    });
  }
}

function handleStatus(deviceId, data) {
  const ts = new Date().toISOString();
  console.log(
    `[MQTT][status] ${ts} device=${deviceId} ` +
      `battery_voltage=${data.battery_voltage} ` +
      `signal_strength=${data.signal_strength} ` +
      `gps_fix=${data.gps_fix}`
  );
}

/**
 * Persist a base64-encoded JPEG frame published by an ESP32 main unit on
 * device/{id}/camera. Frames piggyback on the same trust boundary as telemetry:
 * the device is already authorized/enabled in the devices table, so we don't
 * re-validate per-frame. The decoded image is written to UPLOAD_DIR, recorded in
 * camera_data with a /media path, broadcast to dashboards, and old frames are
 * pruned so disk usage stays bounded.
 */
async function handleCameraFrame(deviceId, data) {
  if (!data.image_base64) {
    console.warn(`[MQTT] Camera frame from ${deviceId} missing image_base64 — discarded`);
    return;
  }

  const pauseCheck = await db.query('SELECT camera_paused FROM devices WHERE device_id = $1', [deviceId]);
  if (pauseCheck.rows.length === 0) {
    console.warn(`[MQTT] Camera frame from unknown device ${deviceId} — discarded`);
    return;
  }
  if (pauseCheck.rows[0].camera_paused) {
    console.log(`[MQTT] Camera frame from ${deviceId} dropped — device is paused`);
    return;
  }

  const timestamp = data.timestamp || new Date().toISOString();
  const uploadDir = process.env.UPLOAD_DIR || './uploads/cameras';
  // Random suffix prevents two frames in the same millisecond from colliding on
  // one filename (which would orphan a camera_data row when the shared file is
  // later pruned). Mirrors the unique naming used by the HTTP upload path.
  const filename = `${deviceId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
  const filePath = path.join(uploadDir, filename);

  try {
    const buffer = Buffer.from(data.image_base64, 'base64');

    const maxBytes = (parseInt(process.env.MAX_IMAGE_SIZE_MB || '15')) * 1024 * 1024;
    if (buffer.length === 0 || buffer.length > maxBytes) {
      console.warn(`[MQTT] Camera frame from ${deviceId} has invalid size (${buffer.length} bytes) — discarded`);
      return;
    }

    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(filePath, buffer);

    const publicPath = `/media/cameras/${filename}`;

    await db.query(
      `INSERT INTO camera_data (device_id, image_path, timestamp)
       VALUES ($1, $2, $3)`,
      [deviceId, publicPath, timestamp]
    );

    wsService.broadcast('camera_frame', {
      device_id: deviceId,
      image_url: publicPath,
      timestamp
    });

    pruneOldFrames(deviceId, uploadDir).catch((err) =>
      console.error(`[MQTT] Frame cleanup failed for ${deviceId}: ${err.message}`)
    );
  } catch (err) {
    console.error(`[MQTT] Failed to process camera frame from ${deviceId}: ${err.message}`);
  }
}

/**
 * Keep only the newest KEEP frames per device — delete the on-disk files and the
 * camera_data rows for everything older so storage doesn't grow unbounded.
 */
async function pruneOldFrames(deviceId, uploadDir) {
  const KEEP = 20;
  const result = await db.query(
    `SELECT image_id, image_path FROM camera_data
     WHERE device_id = $1
     ORDER BY timestamp DESC
     OFFSET $2`,
    [deviceId, KEEP]
  );

  for (const row of result.rows) {
    const fullPath = path.join(uploadDir, path.basename(row.image_path));
    fs.unlink(fullPath, () => {});
  }

  if (result.rows.length > 0) {
    const ids = result.rows.map((r) => r.image_id);
    await db.query(`DELETE FROM camera_data WHERE image_id = ANY($1)`, [ids]);
  }
}

/**
 * Publish a camera control command to a device. Used by the REST API to
 * pause/resume camera snapshots without touching telemetry.
 */
function publishCameraControl(deviceId, action) {
  if (!client || !client.connected) {
    console.warn(`[MQTT] Cannot publish camera control — client not connected`);
    return;
  }
  const topic = `device/${deviceId}/camera/control`;
  const payload = JSON.stringify({ action });
  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error(`[MQTT] Failed to publish camera control to ${deviceId}: ${err.message}`);
    } else {
      console.log(`[MQTT] Published camera control '${action}' to ${deviceId}`);
    }
  });
}

/**
 * Cleanly close the MQTT connection. Called during graceful shutdown.
 */
function close() {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (client) {
    try {
      client.end(true);
    } catch (_) {
      // ignore
    }
    console.log('[MQTT] Connection closed');
  }
}

// handleMessage and handleTelemetry are exported for integration testing of the
// telemetry pipeline; they are not part of the public runtime surface.
module.exports = { init, close, publishCameraControl, handleMessage, handleTelemetry };