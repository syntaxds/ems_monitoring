'use strict';

const axios = require('axios');

const AI_BASE_URL = process.env.AI_ENGINE_URL;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_TIMEOUT = 5000;

/**
 * Fail-safe response used whenever the AI engine is unreachable or times out.
 * Score 1.0 = fully normal under the inverted scoring scheme, so a downed AI
 * engine never produces false anomalies and never blocks the pipeline.
 */
const FALLBACK = {
  anomaly: false,
  risk_level: 'LOW',
  severity_code: 1,
  reason: 'AI service unavailable',
  anomaly_score: 1.0
};

/**
 * Log an AI call failure. Authentication failures (engine rejected our API key
 * with 401/403) are flagged distinctly so invalid-key attempts are visible.
 */
function logAiError(context, err) {
  const status = err.response && err.response.status;
  if (status === 401 || status === 403) {
    console.error(`[AI][AUTH] ${context} rejected (HTTP ${status}) — invalid or missing AI_API_KEY`);
  } else {
    console.error(`[AI] ${context} failed: ${err.message}`);
  }
}

/**
 * Single-device anomaly analysis. Always resolves — on any error it returns
 * the fail-safe response so the telemetry pipeline continues uninterrupted.
 *
 * `voltage` and `engine_status` are optional: when supplied they are forwarded
 * so the engine's low-voltage and engine-off fuel-drop rules can fire; when
 * omitted they are left out of the payload and the engine applies its own
 * defaults (12.4 V / "ON").
 */
async function analyze(deviceId, fuelLevel, timestamp, voltage, engineStatus) {
  try {
    const payload = { device_id: deviceId, fuel_level: fuelLevel, timestamp };
    if (voltage != null) payload.voltage = voltage;
    if (engineStatus != null) payload.engine_status = engineStatus;

    const response = await axios.post(
      `${AI_BASE_URL}/internal/ai/analyze`,
      payload,
      { headers: { 'x-api-key': AI_API_KEY }, timeout: AI_TIMEOUT }
    );
    return response.data;
  } catch (err) {
    logAiError(`analyze for ${deviceId}`, err);
    return { ...FALLBACK, device_id: deviceId };
  }
}

/**
 * Fleet-wide batch analysis. Accepts [{ device_id, fuel_level }, ...].
 * On error, returns a per-device fail-safe array.
 */
async function analyzeBatch(devices) {
  try {
    const response = await axios.post(
      `${AI_BASE_URL}/internal/ai/analyze/batch`,
      { devices },
      { headers: { 'x-api-key': AI_API_KEY }, timeout: AI_TIMEOUT }
    );
    return response.data;
  } catch (err) {
    logAiError('batch analyze', err);
    return devices.map((d) => ({ ...FALLBACK, device_id: d.device_id }));
  }
}

/**
 * Health probe against the AI engine. Returns the engine's payload or an
 * `unreachable` status object — never throws.
 */
async function healthCheck() {
  try {
    const response = await axios.get(`${AI_BASE_URL}/health`, {
      headers: { 'x-api-key': AI_API_KEY },
      timeout: 3000
    });
    return response.data;
  } catch (err) {
    logAiError('health check', err);
    return { status: 'unreachable', error: err.message };
  }
}

module.exports = { analyze, analyzeBatch, healthCheck, FALLBACK };
