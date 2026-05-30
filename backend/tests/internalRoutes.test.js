'use strict';

/**
 * Tests for the internal AI gateway routes (routes/internal.js) and the
 * loopback guard (middleware/internalOnly.js). aiService is mocked so these
 * tests exercise only the HTTP wiring, not the real engine.
 */

jest.mock('../services/aiService');

const express = require('express');
const request = require('supertest');
const aiService = require('../services/aiService');
const internalRouter = require('../routes/internal');
const { internalOnly } = require('../middleware/internalOnly');

/**
 * Build a test app. With `trust proxy` enabled, req.ip is taken from the
 * X-Forwarded-For header, letting us simulate a loopback caller (::1) so the
 * internalOnly guard lets the request through.
 */
function buildApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/internal', internalRouter);
  return app;
}

const asLoopback = (req) => req.set('X-Forwarded-For', '::1');

describe('internalOnly middleware', () => {
  function run(ip) {
    const req = { ip, originalUrl: '/internal/ai/health', connection: {} };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    let nextCalled = false;
    internalOnly(req, res, () => { nextCalled = true; });
    return { nextCalled, res };
  }

  it('allows loopback IPv6 (::1)', () => {
    expect(run('::1').nextCalled).toBe(true);
  });

  it('allows loopback IPv4 (127.0.0.1)', () => {
    expect(run('127.0.0.1').nextCalled).toBe(true);
  });

  it('rejects an external IP with 403', () => {
    const { nextCalled, res } = run('203.0.113.5');
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });
});

describe('GET /internal/ai/health', () => {
  it('returns the aiService health payload', async () => {
    aiService.healthCheck.mockResolvedValue({ status: 'running', model: 'Isolation Forest' });

    const res = await asLoopback(request(buildApp()).get('/internal/ai/health'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'running', model: 'Isolation Forest' });
    expect(aiService.healthCheck).toHaveBeenCalled();
  });
});

describe('POST /internal/ai/analyze', () => {
  it('forwards the body fields to aiService.analyze and returns its result', async () => {
    aiService.analyze.mockResolvedValue({ anomaly: true, severity_code: 3 });

    const res = await asLoopback(request(buildApp()).post('/internal/ai/analyze'))
      .send({ device_id: 'EX-001', fuel_level: 8, timestamp: '2026-05-30T10:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ anomaly: true, severity_code: 3 });
    expect(aiService.analyze).toHaveBeenCalledWith('EX-001', 8, '2026-05-30T10:00:00.000Z');
  });

  it('defaults the timestamp when the caller omits it', async () => {
    aiService.analyze.mockResolvedValue({ anomaly: false });

    await asLoopback(request(buildApp()).post('/internal/ai/analyze'))
      .send({ device_id: 'EX-002', fuel_level: 50 });

    const [, , ts] = aiService.analyze.mock.calls[0];
    expect(typeof ts).toBe('string');
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });
});

describe('POST /internal/ai/analyze/batch', () => {
  it('forwards the devices array to aiService.analyzeBatch', async () => {
    const devices = [{ device_id: 'EX-001', fuel_level: 20 }];
    aiService.analyzeBatch.mockResolvedValue([{ device_id: 'EX-001', anomaly: false }]);

    const res = await asLoopback(request(buildApp()).post('/internal/ai/analyze/batch'))
      .send({ devices });

    expect(res.status).toBe(200);
    expect(aiService.analyzeBatch).toHaveBeenCalledWith(devices);
  });

  it('passes an empty array when no devices are supplied', async () => {
    aiService.analyzeBatch.mockResolvedValue([]);

    await asLoopback(request(buildApp()).post('/internal/ai/analyze/batch')).send({});

    expect(aiService.analyzeBatch).toHaveBeenCalledWith([]);
  });
});
