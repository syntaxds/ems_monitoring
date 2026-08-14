-- Allows hard-deleting a user row without being blocked by the default
-- RESTRICT foreign keys on devices/audit_log/reports. Switches those FKs to
-- ON DELETE SET NULL so audit_log and reports history stays intact (the
-- thesis claims audit logs are permanent) — deleted users just leave the
-- referencing rows with a null actor instead of failing the delete.
-- Idempotent: safe to run on every startup. Never drops data.

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_user_id_fkey;
ALTER TABLE devices ADD CONSTRAINT devices_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_user_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL;
