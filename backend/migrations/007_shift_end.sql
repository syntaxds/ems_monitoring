-- Adds shift end tracking to driver_shift_logs. A unit can now be handed
-- between multiple drivers within the same day, as long as only one driver
-- holds it at a time — so the old UNIQUE(device_id, shift_date) constraint
-- (one claim per unit per day) is replaced by a partial unique index that
-- only applies to 'active' rows (one claim per unit at a time, any day).
-- Idempotent: safe to run on every startup. Never drops data.

ALTER TABLE driver_shift_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE driver_shift_logs DROP CONSTRAINT IF EXISTS driver_shift_logs_status_check;
ALTER TABLE driver_shift_logs ADD CONSTRAINT driver_shift_logs_status_check CHECK (status IN ('active', 'completed'));

ALTER TABLE driver_shift_logs ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;
ALTER TABLE driver_shift_logs ADD COLUMN IF NOT EXISTS fuel_final FLOAT;
ALTER TABLE driver_shift_logs ADD COLUMN IF NOT EXISTS hour_meter_final FLOAT;
ALTER TABLE driver_shift_logs ADD COLUMN IF NOT EXISTS end_photo_path VARCHAR(255);

-- Replaces the old "one claim per unit per day" rule.
ALTER TABLE driver_shift_logs DROP CONSTRAINT IF EXISTS driver_shift_logs_device_id_shift_date_key;

-- Every row defaulted to 'active' above, which can leave pre-existing
-- duplicate "active" claims (same device, or same driver on two devices)
-- from before this constraint existed. Resolve them the same way
-- 005_alert_dedup.sql resolves pre-existing duplicate alerts: keep the most
-- recent active row per device / per driver, force-complete the rest.
UPDATE driver_shift_logs
SET status = 'completed'
WHERE status = 'active'
  AND log_id NOT IN (
    SELECT DISTINCT ON (device_id) log_id
    FROM driver_shift_logs
    WHERE status = 'active'
    ORDER BY device_id, created_at DESC, log_id DESC
  );

UPDATE driver_shift_logs
SET status = 'completed'
WHERE status = 'active'
  AND log_id NOT IN (
    SELECT DISTINCT ON (driver_user_id) log_id
    FROM driver_shift_logs
    WHERE status = 'active'
    ORDER BY driver_user_id, created_at DESC, log_id DESC
  );

-- One active shift per unit at a time (the actual double-booking guard now).
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_shift_logs_active_device
  ON driver_shift_logs (device_id)
  WHERE status = 'active';

-- One active shift per driver at a time (a driver can't be on two units at
-- once) — enforced at the DB level so /end can reliably find "the" active
-- shift for the calling driver without a race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_shift_logs_active_driver
  ON driver_shift_logs (driver_user_id)
  WHERE status = 'active';
