'use strict';

/**
 * Unit tests for the AI gateway client (services/aiService.js).
 *
 * The AI engine is Emilia's Flask service; here we mock its HTTP surface with
 * nock so we can assert (a) the exact request contract the backend sends and
 * (b) the fail-safe behaviour when the engine is unreachable. No Python or live
 * engine is required to run these.
 *
 * aiService reads AI_ENGINE_URL / AI_API_KEY at require() time, so the env must
 * be set before the module is loaded.
 */

const BASE_URL = 'http://ai-test.local:5001';
const API_KEY = 'test-key-123';

process.env.AI_ENGINE_URL = BASE_URL;
process.env.AI_API_KEY = API_KEY;

const nock = require('nock');
const aiService = require('../services/aiService');

const ENGINE_RESULT = {
  status: 'processed',
  device_id: 'EX-001',
  fuel_level: 20,
  anomaly: true,
  risk_level: 'MEDIUM',
  severity_code: 2,
  reason: 'Anomaly detected by ML model',
  anomaly_score: 0.485
};

beforeAll(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.enableNetConnect();
});

describe('aiService.analyze', () => {
  const ts = '2026-05-30T10:00:00.000Z';

  it('posts the documented contract (device_id, fuel_level, timestamp) with the API key header', async () => {
    const scope = nock(BASE_URL, { reqheaders: { 'x-api-key': API_KEY } })
      .post('/internal/ai/analyze', (body) => {
        expect(body.device_id).toBe('EX-001');
        expect(body.fuel_level).toBe(20);
        expect(body.timestamp).toBe(ts);
        return true;
      })
      .reply(200, ENGINE_RESULT);

    const result = await aiService.analyze('EX-001', 20, ts);

    expect(result).toEqual(ENGINE_RESULT);
    expect(scope.isDone()).toBe(true);
  });

  it('forwards voltage and engine_status to the engine when provided', async () => {
    // The engine supports low-voltage and engine-off fuel-drop rules that only
    // fire when these fields are present, so the gateway must forward them.
    const scope = nock(BASE_URL)
      .post('/internal/ai/analyze', (body) => {
        expect(body.voltage).toBe(11.2);
        expect(body.engine_status).toBe('OFF');
        return true;
      })
      .reply(200, ENGINE_RESULT);

    await aiService.analyze('EX-002', 40, ts, 11.2, 'OFF');

    expect(scope.isDone()).toBe(true);
  });

  it('omits voltage/engine_status when not supplied (lets the engine default them)', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/ai/analyze', (body) => {
        expect(body).not.toHaveProperty('voltage');
        expect(body).not.toHaveProperty('engine_status');
        return true;
      })
      .reply(200, ENGINE_RESULT);

    await aiService.analyze('EX-003', 55, ts);

    expect(scope.isDone()).toBe(true);
  });

  it('returns the fail-safe fallback (anomaly:false, score 1.0) when the engine errors', async () => {
    nock(BASE_URL).post('/internal/ai/analyze').reply(500, { error: 'boom' });

    const result = await aiService.analyze('EX-004', 30, ts);

    expect(result).toMatchObject({
      anomaly: false,
      risk_level: 'LOW',
      severity_code: 1,
      anomaly_score: 1.0,
      device_id: 'EX-004'
    });
  });

  it('returns the fail-safe fallback when the engine is unreachable', async () => {
    nock(BASE_URL).post('/internal/ai/analyze').replyWithError('ECONNREFUSED');

    const result = await aiService.analyze('EX-005', 30, ts);

    expect(result.anomaly).toBe(false);
    expect(result.anomaly_score).toBe(1.0);
    expect(result.device_id).toBe('EX-005');
  });

  it('treats an auth rejection (401) as a fail-safe, not a crash', async () => {
    nock(BASE_URL).post('/internal/ai/analyze').reply(401, { error: 'Unauthorized' });

    const result = await aiService.analyze('EX-006', 30, ts);

    expect(result.anomaly).toBe(false);
    expect(result.device_id).toBe('EX-006');
  });
});

describe('aiService.analyzeBatch', () => {
  it('posts the devices array and returns the engine response array', async () => {
    const devices = [
      { device_id: 'EX-001', fuel_level: 20 },
      { device_id: 'EX-002', fuel_level: 50 }
    ];
    const engineResp = devices.map((d) => ({ ...d, anomaly: false, anomaly_score: 0.9 }));

    const scope = nock(BASE_URL)
      .post('/internal/ai/analyze/batch', (body) => {
        expect(body.devices).toHaveLength(2);
        expect(body.devices[0].device_id).toBe('EX-001');
        return true;
      })
      .reply(200, engineResp);

    const result = await aiService.analyzeBatch(devices);

    expect(result).toEqual(engineResp);
    expect(scope.isDone()).toBe(true);
  });

  it('returns a per-device fallback array when the engine errors', async () => {
    const devices = [{ device_id: 'EX-001', fuel_level: 20 }, { device_id: 'EX-002', fuel_level: 50 }];
    nock(BASE_URL).post('/internal/ai/analyze/batch').reply(503);

    const result = await aiService.analyzeBatch(devices);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ anomaly: false, anomaly_score: 1.0, device_id: 'EX-001' });
    expect(result[1].device_id).toBe('EX-002');
  });
});

describe('aiService.healthCheck', () => {
  it('returns the engine health payload', async () => {
    const health = { status: 'running', service: 'AI Engine', model: 'Isolation Forest' };
    nock(BASE_URL).get('/health').reply(200, health);

    const result = await aiService.healthCheck();

    expect(result).toEqual(health);
  });

  it('returns an unreachable status object when the engine is down', async () => {
    nock(BASE_URL).get('/health').replyWithError('ETIMEDOUT');

    const result = await aiService.healthCheck();

    expect(result.status).toBe('unreachable');
    expect(result.error).toBeDefined();
  });
});

describe('aiService.FALLBACK', () => {
  it('is exported and represents a fully-normal, no-alert result', () => {
    expect(aiService.FALLBACK).toMatchObject({
      anomaly: false,
      risk_level: 'LOW',
      severity_code: 1,
      anomaly_score: 1.0
    });
  });
});
