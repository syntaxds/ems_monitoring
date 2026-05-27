'use strict';

/**
 * Seed script. Run once with `node seed.js`.
 *
 * Ensures the schema exists, then creates a default admin user
 * (username=admin, password=admin123) only if the users table is empty.
 * The password is bcrypt-hashed at runtime with cost factor 12 — it is never
 * stored in plaintext or hardcoded as a hash.
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool, runMigrations } = require('./db');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';
const DEFAULT_ROLE = 'admin';
const BCRYPT_COST = 12;

async function seed() {
  try {
    await runMigrations();

    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    if (rows[0].count > 0) {
      console.log('[Seed] Users already exist, skipping admin creation.');
      console.log('Seed complete');
      return;
    }

    const hash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_COST);
    await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [DEFAULT_USERNAME, hash, DEFAULT_ROLE]
    );

    console.log(`[Seed] Created default admin user "${DEFAULT_USERNAME}".`);
    console.log('Seed complete');
  } catch (err) {
    console.error(`[Seed] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
