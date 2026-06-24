'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { loginRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

async function audit(userId, action, description) {
  try {
    await db.query(
      'INSERT INTO audit_log (user_id, action, description) VALUES ($1, $2, $3)',
      [userId, action, description]
    );
  } catch (err) {
    console.error(`[Audit] Failed to write ${action}: ${err.message}`);
  }
}

/**
 * POST /api/auth/login
 * Returns a signed JWT on success. Uses a single generic error for both
 * unknown usernames and bad passwords to avoid user enumeration.
 */
router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await db.query(
      'SELECT user_id, username, password, role FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];
    const passwordOk = user ? await bcrypt.compare(password, user.password) : false;

    if (!user || !passwordOk) {
      await audit(user ? user.user_id : null, 'LOGIN_FAILED', `Failed login for username "${username}"`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await audit(user.user_id, 'LOGIN_SUCCESS', `User "${username}" logged in`);

    return res.json({ token, role: user.role, user_id: user.user_id, username: user.username });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
