'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Global API rate limiter: 100 requests per hour per IP.
 * Internal routes (/internal/*) are skipped — they are localhost-only and
 * carry the high-frequency telemetry analysis traffic.
 */
const apiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/internal/'),
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests' });
  }
});

module.exports = { apiRateLimiter };
