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
 * Last migration that shipped before schema_migrations tracking existed.
 * Everything up to and including this file used to be re-executed on every
 * boot, so an already-deployed database has them applied without any record
 * of it — see backfillPreTrackingMigrations.
 */
const PRE_TRACKING_BASELINE = '010_shift_log_user_delete_fk.sql';

/**
 * True if the database already carries the schema change made by the baseline
 * migration (driver_shift_logs.driver_user_id made nullable by 010). Used as
 * the marker for "this is an existing deployment, not a fresh database".
 */
async function schemaIsAtBaseline() {
  const result = await pool.query(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_name = 'driver_shift_logs' AND column_name = 'driver_user_id'`
  );
  return result.rowCount > 0 && result.rows[0].is_nullable === 'YES';
}

/**
 * On the first boot after migration tracking was introduced, record the
 * pre-tracking migrations as applied instead of replaying 001..baseline from
 * scratch on a database that already ran them. Only kicks in when the schema
 * marker proves they really did run — a genuinely fresh database has no marker
 * and falls through to the normal "run everything" path.
 */
async function backfillPreTrackingMigrations(files, applied) {
  if (applied.size > 0 || !(await schemaIsAtBaseline())) {
    return;
  }
  const preTracking = files.filter((f) => f <= PRE_TRACKING_BASELINE);
  await pool.query(
    `INSERT INTO schema_migrations (filename)
     SELECT unnest($1::text[]) ON CONFLICT (filename) DO NOTHING`,
    [preTracking]
  );
  preTracking.forEach((f) => applied.add(f));
  console.log(
    `[DB] Existing schema detected — backfilled ${preTracking.length} pre-tracking migrations as applied`
  );
}

/**
 * Apply pending SQL migrations from /migrations in filename order at startup.
 * Each file runs at most once ever: it executes inside a transaction together
 * with its schema_migrations row, so a failed migration is never recorded and
 * a recorded migration is never replayed. This is what makes migration order
 * safe — a file no longer has to stay compatible with every later file
 * re-asserting itself on the next boot.
 */
async function runMigrations() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   VARCHAR(255) PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT NOW()
     )`
  );

  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const recorded = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(recorded.rows.map((r) => r.filename));

  await backfillPreTrackingMigrations(files, applied);

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // eslint-disable-next-line no-await-in-loop
    const client = await pool.connect();
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.query('BEGIN');
      // eslint-disable-next-line no-await-in-loop
      await client.query(sql);
      // eslint-disable-next-line no-await-in-loop
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      // eslint-disable-next-line no-await-in-loop
      await client.query('COMMIT');
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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
