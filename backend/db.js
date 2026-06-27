'use strict';

const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// pg parses TIMESTAMP WITHOUT TIME ZONE (OID 1114) using new Date(str) which
// treats the string as LOCAL time on Windows. All timestamps in this system
// are stored as UTC, so force UTC parsing by appending Z before constructing
// the Date — this fixes 7-hour offsets in JSON API responses on WIB machines.
types.setTypeParser(1114, (val) => (val ? new Date(val + 'Z') : null));

/**
 * PostgreSQL connection pool. All queries in the application MUST go through
 * this pool using parameterized statements ($1, $2, ...). Never interpolate
 * user-controlled values into SQL strings.
 */
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'ems_db',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error(`[DB] Unexpected idle client error: ${err.message}`);
});

/**
 * Apply every SQL migration in /migrations in filename order at startup.
 * Migrations use IF NOT EXISTS semantics so they are safe to run repeatedly
 * and never destroy existing data.
 */
async function runMigrations() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // eslint-disable-next-line no-await-in-loop
    await pool.query(sql);
    console.log(`[DB] Migration ${file} applied at ${new Date().toISOString()}`);
  }
}

/**
 * Verify connectivity. Throws if the database cannot be reached.
 */
async function testConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log(`[DB] Connected to ${process.env.DB_NAME || 'ems_db'}@${process.env.DB_HOST || 'localhost'}`);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  runMigrations,
  testConnection
};
