'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_ROLES = ['admin', 'operator', 'viewer'];

const DEFAULT_JOB_TITLE = { admin: 'Admin', operator: 'PM', viewer: 'Director' };

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
 * GET /api/users
 * Returns all users (never password hash).
 */
router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT user_id, username, email, job_title, role, active, created_at
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
    const { username, email, password, job_title, role } = req.body || {};

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password, and role are required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }

    const resolvedJobTitle = job_title || DEFAULT_JOB_TITLE[role];
    const hashed = await bcrypt.hash(password, 12);

    let result;
    try {
      result = await db.query(
        `INSERT INTO users (username, email, password, job_title, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING user_id, username, email, job_title, role, active, created_at`,
        [username, email || null, hashed, resolvedJobTitle, role]
      );
    } catch (e) {
      if (e.code === '23505') {
        const field = e.constraint && e.constraint.includes('email') ? 'Email' : 'Username';
        return res.status(409).json({ error: `${field} already in use` });
      }
      throw e;
    }

    await auditUser(
      req.user.user_id,
      'USER_CREATED',
      `Admin "${req.user.username}" created user "${username}" with role "${role}"`
    );

    return res.status(201).json(result.rows[0]);
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

module.exports = router;
