-- Completes what 009 started: driver_shift_logs.driver_user_id was missed and
-- still had the default NO ACTION FK, so deleting a driver who has ever
-- started a shift failed with a raw 23503 instead of succeeding. Shift logs
-- are evidentiary records like audit_log, so they must survive the driver
-- account being deleted — the actor reference is nulled, the row stays.
-- The column has to become nullable for ON DELETE SET NULL to be legal.
-- Idempotent: safe to run on every startup. Never drops data.

ALTER TABLE driver_shift_logs ALTER COLUMN driver_user_id DROP NOT NULL;

ALTER TABLE driver_shift_logs DROP CONSTRAINT IF EXISTS driver_shift_logs_driver_user_id_fkey;
ALTER TABLE driver_shift_logs ADD CONSTRAINT driver_shift_logs_driver_user_id_fkey
  FOREIGN KEY (driver_user_id) REFERENCES users(user_id) ON DELETE SET NULL;
