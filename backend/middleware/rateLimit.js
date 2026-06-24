'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Paths exempt from the general API limiter:
 *   /internal/* — loopback-only, high-frequency telemetry analysis.
 *   /media/*    — static camera images; image loads must not burn the API budget.
 *   /health     — uptime/load-balancer probes; throttling these can falsely mark
 *                 the service down.
 */
function isExempt(req) {
  return (
    req.path.startsWith('/internal/') ||
    req.path.startsWith('/media/') ||
    req.path === '/health'
  );
}

/**
 * General API limiter. A live monitoring dashboard is chatty (per-device fetches,
 * polling, multiple operators behind one office NAT), so we use a SHORT window
 * with a generous ceiling rather than a long 1-hour window: if a client does get
 * limited, it recovers in minutes, and a single burst can't lock them out for an
 * hour. 1000 / 15 min ≈ 1.1 req/s sustained per IP — far above normal use, far
 * below what's useful for scraping or abuse.
 */
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isExempt,
  handler: (req, res) => {
    console.warn(`[RateLimit] API limit hit: ip=${req.ip} path=${req.path}`);
    res.status(429).json({ error: 'Too many requests' });
  }
});

/**
 * Strict limiter for credential endpoints (login). Kept SEPARATE from the general
 * limiter so the general ceiling can be generous without weakening brute-force
 * protection.
 *
 *  - `skipSuccessfulRequests: true` — only FAILED attempts count, so a legitimate
 *    user who logs in repeatedly (expired token, etc.) is never penalized; only
 *    password-guessing is throttled.
 *  - keyed by IP + username so one attacker can't lock every account from a
 *    shared IP, and password spraying across usernames is still bounded per IP.
 *  - bcrypt verification is intentionally expensive, so this also caps the CPU/DoS
 *    surface of /login.
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 7,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const username = req.body && req.body.username
      ? String(req.body.username).toLowerCase().slice(0, 100)
      : '';
    return username ? `${req.ip}:${username}` : req.ip;
  },
  handler: (req, res) => {
    console.warn(`[RateLimit] Login limit hit: ip=${req.ip} user=${req.body && req.body.username}`);
    res.status(429).json({ error: 'Too many login attempts, please try again later' });
  }
});

module.exports = { apiRateLimiter, loginRateLimiter };
