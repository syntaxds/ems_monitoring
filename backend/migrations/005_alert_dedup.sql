-- Deduplicate active alerts and enforce one active alert per (device_id, alert_type).
-- Idempotent: safe to run on every startup. Never drops data (duplicates are
-- acknowledged, not deleted, so history is preserved).
--
-- Background: the MQTT pipeline used to insert a new alert row on every anomalous
-- telemetry message (~every 15s), accumulating hundreds of duplicate rows for a
-- device stuck in an anomalous state. This migration collapses the backlog and
-- the partial unique index prevents it from recurring.

-- 1. Keep the most recent active alert per (device_id, alert_type); acknowledge
--    the rest so the unique index below can be built.
UPDATE alerts
SET status = 'acknowledged'
WHERE status = 'active'
  AND alert_id NOT IN (
    SELECT DISTINCT ON (device_id, alert_type) alert_id
    FROM alerts
    WHERE status = 'active'
    ORDER BY device_id, alert_type, timestamp DESC, alert_id DESC
  );

-- 2. Enforce at most one active alert per device+type. Acknowledged alerts are
--    not covered, so a fresh anomaly can raise a new alert after acknowledgement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_active_per_device_type
  ON alerts (device_id, alert_type)
  WHERE status = 'active';
