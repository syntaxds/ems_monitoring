'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { loginRateLimiter, forgotPasswordRateLimiter } = require('../middleware/rateLimit');
const { sendPasswordResetEmail } = require('../services/emailService');

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
 * Rejects inactive accounts with the same generic error (no state leak).
 */
router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await db.query(
      'SELECT user_id, username, password, role, active FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];
    const passwordOk = user ? await bcrypt.compare(password, user.password) : false;

    if (!user || !passwordOk) {
      await audit(user ? user.user_id : null, 'LOGIN_FAILED', `Failed login for username "${username}"`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.active === false) {
      await audit(user.user_id, 'LOGIN_FAILED', `Login attempt by disabled account "${username}"`);
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

/**
 * POST /api/auth/forgot-password
 * Always returns the same message regardless of whether the email exists
 * to prevent account enumeration.
 */
router.post('/forgot-password', forgotPasswordRateLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!/@pmjsystem\.com$/i.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please check your email again' });
  }

  const genericResponse = { message: 'If that email is registered, a reset link has been sent.' };

  try {
    const result = await db.query(
      'SELECT user_id, active FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0 || result.rows[0].active === false) {
      return res.status(400).json({ error: 'Please check your email again' });
    }

    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.user_id, token, expiresAt]
    );

    await sendPasswordResetEmail(email, token);

    return res.json(genericResponse);
  } catch (err) {
    console.error(`[Auth] forgot-password error: ${err.message}`);
    return res.json(genericResponse);
  }
});

/**
 * POST /api/auth/reset-password
 * Validates the token and updates the user's password.
 */
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const result = await db.query(
      'SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const row = result.rows[0];
    if (row.used || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);

    await db.query('UPDATE users SET password = $1 WHERE user_id = $2', [hashed, row.user_id]);
    await db.query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [token]);
    await db.query(
      'INSERT INTO audit_log (user_id, action, description) VALUES ($1, $2, $3)',
      [row.user_id, 'PASSWORD_RESET', 'User reset password via email link']
    );

    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(`[Auth] reset-password error: ${err.message}`);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

module.exports = router;
