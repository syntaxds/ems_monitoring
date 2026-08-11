-- Adds the "driver" role and the driver_shift_logs table for shift start
-- check-in (unit claim, fuel/HM readings, photo proof).
-- Idempotent: safe to run on every startup. Never drops data.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator', 'viewer', 'driver'));

CREATE TABLE IF NOT EXISTS driver_shift_logs (
  log_id          SERIAL PRIMARY KEY,
  driver_user_id  INT NOT NULL REFERENCES users(user_id),
  device_id       VARCHAR(50) NOT NULL REFERENCES devices(device_id),
  shift_date      DATE NOT NULL,
  start_time      TIMESTAMP NOT NULL,
  fuel_initial    FLOAT NOT NULL,
  hour_meter      FLOAT NOT NULL,
  photo_path      VARCHAR(255) NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (device_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_driver_shift_logs_date ON driver_shift_logs(shift_date);
