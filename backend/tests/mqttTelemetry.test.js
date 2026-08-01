'use strict';

/**
 * Integration tests for the MQTT telemetry pipeline (services/mqttService.js).
 *
 * This is where the whole AI integration comes together on each telemetry
 * message: device authorization -> persist telemetry/GPS -> AI anomaly analysis
 * -> alert creation + device flagging -> WebSocket broadcast. db, aiService,
 * wsService and deviceAuth are all mocked so the test is hermetic.
 *
 * Requires mqttService to export its telemetry handler for testability.
 */

jest.mock('../db');
jest.mock('../services/aiService');
jest.mock('../services/wsService');
jest.mock('../services/deviceAuth');

const db = require('../db');
const aiService = require('../services/aiService');
const wsService = require('../services/wsService');
const { validateDevice } = require('../services/deviceAuth');
const mqttService = require('../services/mqttService');

const handleTelemetry = mqttService.handleTelemetry;

beforeEach(() => {
  validateDevice.mockResolvedValue(true);
  db.query.mockResolvedValue({ rows: [{ alert_id: 99 }] });
  aiService.analyze.mockResolvedValue({ anomaly: false, anomaly_score: 0.95, risk_level: 'LOW' });
});

const telemetry = (over = {}) => ({
  device_token: 'tok',
  fuel_level: 45,
  voltage: 12.4,
  engine_status: 'running',
  timestamp: '2026-05-30T10:00:00.000Z',
  ...over
});

describe('mqttService.handleTelemetry', () => {
  it('exports a telemetry handler', () => {
    expect(typeof handleTelemetry).toBe('function');
  });

  it('rejects unauthorized devices before persisting or analyzing', async () => {
    validateDevice.mockResolvedValue(false);

    await handleTelemetry('EX-001', telemetry());

    expect(db.query).not.toHaveBeenCalled();
    expect(aiService.analyze).not.toHaveBeenCalled();
  });

  it('persists fuel telemetry and runs AI analysis for an authorized device', async () => {
    await handleTelemetry('EX-001', telemetry());

    const insertedFuel = db.query.mock.calls.some(
      ([sql]) => /insert into fuel_data/i.test(sql)
    );
    expect(insertedFuel).toBe(true);
    expect(aiService.analyze).toHaveBeenCalled();
  });

  it('forwards voltage and engine_status to the AI engine', async () => {
    await handleTelemetry('EX-001', telemetry({ voltage: 11.1, engine_status: 'off', fuel_level: 30 }));

    expect(aiService.analyze).toHaveBeenCalledWith(
      'EX-001',
      30,
      '2026-05-30T10:00:00.000Z',
      11.1,
      'off'
    );
  });

  it('creates an alert, flags the device, and broadcasts when an anomaly is detected', async () => {
    aiService.analyze.mockResolvedValue({
      anomaly: true,
      severity_code: 3,
      risk_level: 'HIGH',
      reason: 'Fuel level below safe threshold',
      anomaly_score: 0.1
    });

    await handleTelemetry('EX-001', telemetry({ fuel_level: 5 }));

    const insertedAlert = db.query.mock.calls.find(([sql]) => /insert into alerts/i.test(sql));
    expect(insertedAlert).toBeDefined();
    expect(insertedAlert[1]).toEqual(
      expect.arrayContaining(['EX-001', 'fuel_anomaly', 'Fuel level below safe threshold', 'high'])
    );

    const flagged = db.query.mock.calls.some(
      ([sql]) => /update devices set status = 'anomaly'/i.test(sql)
    );
    expect(flagged).toBe(true);

    expect(wsService.broadcast).toHaveBeenCalledWith('alert_new', expect.objectContaining({
      alert_id: 99,
      device_id: 'EX-001',
      severity: 'high'
    }));
  });

  it('does NOT create an alert when telemetry is normal', async () => {
    await handleTelemetry('EX-001', telemetry());

    const insertedAlert = db.query.mock.calls.some(([sql]) => /insert into alerts/i.test(sql));
    expect(insertedAlert).toBe(false);
  });

  it('always broadcasts a live fuel_update for connected dashboards', async () => {
    await handleTelemetry('EX-001', telemetry());

    expect(wsService.broadcast).toHaveBeenCalledWith('fuel_update', expect.objectContaining({
      device_id: 'EX-001',
      fuel_level: 45
    }));
  });
});
