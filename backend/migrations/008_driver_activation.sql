-- Adds self-activation flow for driver accounts: admin creates the account
-- record but the driver sets their own password via an emailed link.
-- Idempotent: safe to run on every startup. Never drops data.

ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_activation_status_check;
ALTER TABLE users ADD CONSTRAINT users_activation_status_check CHECK (activation_status IN ('pending', 'active'));

CREATE TABLE IF NOT EXISTS account_activation_tokens (
  token_id   SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token      VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used       BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activation_tokens_token ON account_activation_tokens(token);
