-- Adds camera pause/resume state to devices and a per-device view-heartbeat table.
-- Idempotent: safe to run on every startup. Never drops data.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS camera_paused BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS camera_view_heartbeats (
  device_id      VARCHAR(50) PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  last_viewed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cam_heartbeat_last_viewed
  ON camera_view_heartbeats(last_viewed_at);
