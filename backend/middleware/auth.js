'use strict';

const jwt = require('jsonwebtoken');

/**
 * Extract and verify the JWT from the Authorization header.
 * Returns the decoded payload, or throws if missing/invalid.
 */
function verifyToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('Missing or malformed Authorization header');
    err.status = 401;
    throw err;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    const err = new Error('Invalid or expired token');
    err.status = 401;
    throw err;
  }
}

/**
 * requireAuth — verifies the JWT and attaches the decoded payload to req.user.
 */
function requireAuth(req, res, next) {
  try {
    req.user = verifyToken(req);
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({ error: err.message });
  }
}

/**
 * requireRole(...roles) — verifies the JWT and checks that req.user.role is
 * one of the allowed roles. Returns 403 on role mismatch.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    try {
      req.user = verifyToken(req);
    } catch (err) {
      return res.status(err.status || 401).json({ error: err.message });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
