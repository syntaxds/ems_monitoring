'use strict';

/**
 * Centralized Express error handler. Must be mounted last.
 * Logs the full error server-side (with timestamp); returns a clean JSON
 * body to the client. Stack traces are never exposed in production.
 */
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const timestamp = new Date().toISOString();

  console.error(`[Error] ${timestamp} ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    console.error(err.stack);
  }

  if (res.headersSent) {
    return next(err);
  }

  const message =
    status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error';

  res.status(status).json({ error: message });
}

/**
 * 404 handler for unmatched routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

module.exports = { errorHandler, notFoundHandler };
