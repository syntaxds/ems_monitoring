'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendAccountActivationEmail } = require('../services/emailService');

const router = express.Router();

const ACTIVATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generates an account-activation token, stores it, and emails it. Returns
 * whether the email actually sent — callers must surface failures to the
 * admin rather than swallowing them, since the account is otherwise unusable
 * until activated.
 */
async function issueActivationToken(userId, email, username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS);

  await db.query(
    'INSERT INTO account_activation_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );

  return sendAccountActivationEmail(email, token, username);
}

const VALID_ROLES = ['admin', 'operator', 'viewer', 'driver'];

const DEFAULT_JOB_TITLE = { admin: 'Admin', operator: 'PM', viewer: 'Director', driver: 'Driver' };

async function auditUser(adminId, action, description) {
  try {
    await db.query(
      'INSERT INTO audit_log (user_id, action, description) VALUES ($1, $2, $3)',
      [adminId, action, description]
    );
  } catch (err) {
    console.error(`[Audit] Failed to write ${action}: ${err.message}`);
  }
}

/**
 * Returns true if `target` is an admin and there is at most one active admin
 * account in the system. Applies regardless of whether the target itself is
 * currently active — only the count of active admins matters.
 */
async function isLastActiveAdmin(target) {
  if (target.role !== 'admin') {
    return false;
  }
  const result = await db.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND active = true"
  );
  return result.rows[0].count === 1;
}

/**
 * GET /api/users
 * Returns all users (never password hash).
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT user_id, username, email, job_title, role, active, activation_status, created_at
       FROM users
       ORDER BY created_at ASC`
    );
    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/users
 * Create a new user.
 */
router.post('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { username, email, job_title, role } = req.body || {};

    if (!username || !role) {
      return res.status(400).json({ error: 'username and role are required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    // Every account is activated by the user themself via an emailed link,
    // so admins never set (or see) a password — an email is required
    // instead, since that's where the activation link goes.
    if (!email) {
      return res.status(400).json({ error: 'Email is required to create a user account' });
    }

    const resolvedJobTitle = job_title || DEFAULT_JOB_TITLE[role];

    // Accounts start with a random, never-disclosed placeholder hash — the
    // account can't be logged into until the user sets their own password
    // through the activation link.
    const hashed = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

    let result;
    try {
      result = await db.query(
        `INSERT INTO users (username, email, password, job_title, role, activation_status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING user_id, username, email, job_title, role, active, activation_status, created_at`,
        [username, email, hashed, resolvedJobTitle, role]
      );
    } catch (e) {
      if (e.code === '23505') {
        const field = e.constraint && e.constraint.includes('email') ? 'Email' : 'Username';
        return res.status(409).json({ error: `${field} already in use` });
      }
      throw e;
    }

    const createdUser = result.rows[0];

    await auditUser(
      req.user.user_id,
      'USER_CREATED',
      `Admin "${req.user.username}" created user "${username}" with role "${role}"`
    );

    const activationEmailSent = await issueActivationToken(createdUser.user_id, email, username);

    return res.status(201).json({ ...createdUser, activation_email_sent: activationEmailSent });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/users/:id/resend-activation
 * Re-sends the account-activation email for a pending account, invalidating
 * any prior unused tokens first. Used when the first email failed to send or
 * the link expired before the user used it.
 */
router.post('/:id/resend-activation', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    const result = await db.query(
      'SELECT user_id, username, email, role, activation_status FROM users WHERE user_id = $1',
      [targetId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const target = result.rows[0];
    if (target.activation_status !== 'pending') {
      return res.status(400).json({ error: 'Only pending accounts can be sent an activation email' });
    }
    if (!target.email) {
      return res.status(400).json({ error: 'User has no email on file' });
    }

    await db.query(
      'UPDATE account_activation_tokens SET used = true WHERE user_id = $1 AND used = false',
      [target.user_id]
    );

    const activationEmailSent = await issueActivationToken(target.user_id, target.email, target.username);

    await auditUser(
      req.user.user_id,
      'ACTIVATION_EMAIL_RESENT',
      `Admin "${req.user.username}" resent activation email to user_id ${target.user_id}`
    );

    return res.json({ activation_email_sent: activationEmailSent });
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /api/users/:id
 * Partial update: email, job_title, role, active. No password changes here.
 */
router.put('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { email, job_title, role, active } = req.body || {};

    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const existing = await db.query('SELECT * FROM users WHERE user_id = $1', [targetId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const cur = existing.rows[0];
    const newEmail = email !== undefined ? email : cur.email;
    const newJobTitle = job_title !== undefined ? job_title : cur.job_title;
    const newRole = role !== undefined ? role : cur.role;
    const newActive = active !== undefined ? active : cur.active;

    let result;
    try {
      result = await db.query(
        `UPDATE users
         SET email = $1, job_title = $2, role = $3, active = $4
         WHERE user_id = $5
         RETURNING user_id, username, email, job_title, role, active, created_at`,
        [newEmail, newJobTitle, newRole, newActive, targetId]
      );
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: 'Email already in use' });
      }
      throw e;
    }

    await auditUser(
      req.user.user_id,
      'USER_UPDATED',
      `Admin "${req.user.username}" updated user_id ${targetId}`
    );

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /api/users/:id/deactivate
 */
router.put('/:id/deactivate', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    if (targetId === req.user.user_id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const existing = await db.query('SELECT * FROM users WHERE user_id = $1', [targetId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (await isLastActiveAdmin(existing.rows[0])) {
      return res.status(400).json({ error: 'Cannot deactivate the only remaining admin account' });
    }

    const result = await db.query(
      `UPDATE users SET active = false WHERE user_id = $1
       RETURNING user_id, username, email, job_title, role, active, created_at`,
      [targetId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await auditUser(
      req.user.user_id,
      'USER_DEACTIVATED',
      `Admin "${req.user.username}" deactivated user_id ${targetId}`
    );

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

/**
 * PUT /api/users/:id/reactivate
 */
router.put('/:id/reactivate', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    const result = await db.query(
      `UPDATE users SET active = true WHERE user_id = $1
       RETURNING user_id, username, email, job_title, role, active, created_at`,
      [targetId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await auditUser(
      req.user.user_id,
      'USER_REACTIVATED',
      `Admin "${req.user.username}" reactivated user_id ${targetId}`
    );

    return res.json(result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /api/users/:id
 * Hard-deletes a user. devices/audit_log/reports rows referencing the user
 * lose the actor reference (ON DELETE SET NULL, see migration 009) rather
 * than being removed themselves.
 */
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);

    if (targetId === req.user.user_id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const existing = await db.query('SELECT * FROM users WHERE user_id = $1', [targetId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const target = existing.rows[0];
    if (await isLastActiveAdmin(target)) {
      return res.status(400).json({ error: 'Cannot delete the only remaining admin account' });
    }

    await db.query('DELETE FROM users WHERE user_id = $1', [targetId]);

    await auditUser(
      req.user.user_id,
      'USER_DELETED',
      `Admin "${req.user.username}" deleted user_id ${targetId} (username: ${target.username})`
    );

    return res.json({ message: `User "${target.username}" deleted` });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
