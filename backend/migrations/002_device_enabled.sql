-- Authorization flag for devices, separate from the live telemetry `status`.
-- `enabled` gates whether a device may submit telemetry / camera frames;
-- `status` (idle/active/anomaly) remains purely the live operational state.
-- Idempotent: safe to run on every startup.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_token VARCHAR (100);

UPDATE devices SET device_token = '<secret-token>', operator_name = 'Manik' WHERE device_id = 'PMJ-001';