'use strict';

const mqtt = require('mqtt');
const db = require('../db');
const aiService = require('./aiService');
const wsService = require('./wsService');
const { validateDevice } = require('./deviceAuth');

const TELEMETRY_TOPIC = 'device/+/telemetry';
const STATUS_TOPIC = 'device/+/status';
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;

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
    client.subscribe([TELEMETRY_TOPIC, STATUS_TOPIC], { qos: 1 }, (err) => {
      if (err) {
        console.error(`[MQTT] Subscription failed: ${err.message}`);
      } else {
        console.log(`[MQTT] Subscribed to ${TELEMETRY_TOPIC} and ${STATUS_TOPIC}`);
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
  if (retryCount >= MAX_RETRIES) {
    console.error(`[MQTT] Max reconnect attempts (${MAX_RETRIES}) reached — giving up until restart.`);
    return;
  }
  const delay = BASE_BACKOFF_MS * Math.pow(2, retryCount);
  retryCount += 1;
  console.warn(`[MQTT] Disconnected. Reconnect attempt ${retryCount}/${MAX_RETRIES} in ${delay}ms`);
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
  const engineStatus = data.engine_status || null;
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
  const aiResult = await aiService.analyze(deviceId, fuelLevel, timestamp);

  // 7. Create alert and flag device if anomaly detected.
  if (aiResult.anomaly === true) {
    const severity = severityMap[aiResult.severity_code] || 'medium';
    const message = aiResult.reason || 'Anomaly detected by ML model';

    const inserted = await db.query(
      `INSERT INTO alerts (device_id, alert_type, alert_message, severity)
       VALUES ($1, $2, $3, $4)
       RETURNING alert_id`,
      [deviceId, 'fuel_anomaly', message, severity]
    );

    await db.query(
      `UPDATE devices SET status = 'anomaly' WHERE device_id = $1`,
      [deviceId]
    );

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

module.exports = { init, close };