'use strict';

const express = require('express');
const aiService = require('../services/aiService');
const { internalOnly } = require('../middleware/internalOnly');

const router = express.Router();

// Every route here is loopback-only and exempt from the public rate limiter.
router.use(internalOnly);

/**
 * GET /internal/ai/health
 * Proxy health check to the external AI engine.
 */
router.get('/ai/health', async (req, res) => {
  const result = await aiService.healthCheck();
  res.json(result);
});

/**
 * POST /internal/ai/analyze
 * Internal single-device analysis proxy. The frontend must never call this.
 * The AI engine expects fuel as a percentage (0-100); prefer fuel_pct when the
 * caller supplies it, falling back to fuel_level for backward compatibility.
 *
 * voltage and engine_status are normalised and forwarded exactly as the live
 * MQTT ingestion path does (see handleTelemetry in services/mqttService.js), so
 * the engine's low-voltage and engine-off fuel-drop rules can fire through this
 * path too — without them the engine silently applied its own defaults.
 */
router.post('/ai/analyze', async (req, res) => {
  const { device_id, fuel_level, fuel_pct, timestamp, voltage, engine_status } = req.body || {};
  const fuelForAi = fuel_pct != null ? fuel_pct : fuel_level;
  const voltageForAi = voltage != null ? Number(voltage) : null;
  const rawEngine = engine_status ? String(engine_status).toLowerCase() : null;
  const engineStatusForAi = rawEngine === 'running' || rawEngine === 'idle' ? rawEngine : 'off';
  const result = await aiService.analyze(
    device_id,
    fuelForAi,
    timestamp || new Date().toISOString(),
    voltageForAi,
    engineStatusForAi
  );
  res.json(result);
});

/**
 * POST /internal/ai/analyze/batch
 * Internal fleet-wide batch analysis proxy.
 */
router.post('/ai/analyze/batch', async (req, res) => {
  const devices = (req.body && req.body.devices) || [];
  const result = await aiService.analyzeBatch(devices);
  res.json(result);
});

module.exports = router;
