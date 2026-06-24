-- Adds role/job_title restructure, email, active flag, and password reset tokens.
-- Idempotent: safe to run on every startup. Never drops data.

ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Migrate old role values to new ones before re-adding constraint.
UPDATE users SET role = 'operator' WHERE role = 'supervisor';
UPDATE users SET role = 'viewer'   WHERE role = 'director';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator', 'viewer'));

UPDATE users SET job_title = 'Admin' WHERE username = 'admin' AND job_title IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_id   SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token      VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used       BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token);
