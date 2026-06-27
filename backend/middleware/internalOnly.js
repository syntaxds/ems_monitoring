'use strict';

/**
 * Restricts a route to loopback callers only (127.0.0.1 or ::1).
 * Used to guard /internal/* endpoints so the AI gateway routes are never
 * reachable from outside the host. The frontend must never call these.
 */
function internalOnly(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const normalized = ip.replace('::ffff:', '');
  const allowed = ['127.0.0.1', '::1', 'localhost'];
  if (allowed.includes(normalized) || allowed.includes(ip)) {
    return next();
  }
  console.warn(`[Internal] Rejected non-local request to ${req.originalUrl} from ${ip}`);
  return res.status(403).json({ error: 'Forbidden' });
}

module.exports = { internalOnly };
