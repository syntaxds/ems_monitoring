# MQTT Contract — EMS Device Ingestion

This contract governs how IoT devices (ESP32 + GPS + ESP32-CAM) publish telemetry
to the EMS backend gateway. It reflects the **implemented** behaviour of
`backend/services/mqttService.js` and the `iot-device` firmware.

## Broker Connection

| Property | Value |
|----------|-------|
| Broker | HiveMQ Cloud (or any MQTT broker over TLS) |
| Protocol | MQTT over **TLS** (`mqtts://`) |
| Port | `8883` (native MQTT/TLS — **not** 8884, which is WebSocket) |
| Host | `MQTT_HOST` (backend `.env`) |
| Auth | **Username / password** — `MQTT_USER` / `MQTT_PASS`. No X.509 client certs. |
| QoS | 1 |

Backend configuration (`backend/.env`):
```
MQTT_HOST=<your-broker-host>
MQTT_PORT=8883
MQTT_USER=<broker-username>
MQTT_PASS=<broker-password>
```
If `MQTT_HOST` is unset, MQTT ingestion is disabled and the backend logs a warning
but keeps running (HTTP API + WebSocket stay up).

> The device and the backend must connect to the **same broker**. A local
> `mosquitto` broker (see the project's Docker setup) can be used to simulate the
> device during development; the real device publishes to the cloud broker.

## Topics

| Topic | Publisher | Frequency |
|-------|-----------|-----------|
| `device/{device_id}/telemetry` | Device | every ~15 s |
| `device/{device_id}/status` | Device (optional) | — |

The backend subscribes with wildcards: `device/+/telemetry`, `device/+/status`.
The `device_id` is taken from the **topic** (e.g. `EXCAVATOR_001`). The current
firmware publishes only `telemetry`; `status` is optional (logged, not persisted).

### Telemetry payload — `device/{device_id}/telemetry`

```json
{
  "device_id": "EXCAVATOR_001",
  "device_token": "<per-device-secret>",
  "timestamp": "2026-05-27T13:17:20Z",
  "fuel_level": 420.5,
  "fuel_pct": 70.1,
  "engine_status": "running",
  "voltage": 12.6,
  "gps_valid": true,
  "satellites": 7,
  "hdop": 1.2,
  "latitude": -6.200000,
  "longitude": 106.816666,
  "cam_ip": "192.168.1.50",
  "stream_url": "http://192.168.1.50/stream",
  "mdns_url": "http://excavator-cam.local/stream"
}
```

| Field | Type | Persisted? | Notes |
|-------|------|-----------|-------|
| `device_token` | string | — | **required**; validated against `devices.device_token` |
| `timestamp` | string | yes | ISO 8601; backend substitutes server time if absent |
| `fuel_level` | number | yes (`fuel_data`) | litres |
| `engine_status` | string | yes (`fuel_data`) | `running` \| `idle` \| `off` |
| `voltage` | number | yes (`fuel_data`) | battery volts |
| `latitude` / `longitude` | number \| null | yes (`gps_data`) | **`null` when no GPS fix** — row is skipped if either is null |
| `stream_url` | string | yes (`camera_data`) | camera MJPEG URL; triggers a `camera_frame` broadcast |
| `cam_ip`, `mdns_url` | string | — | forwarded in the `camera_frame` WS event only |
| `device_id` | string | — | informational; the topic segment is authoritative |
| `fuel_pct`, `gps_valid`, `satellites`, `hdop` | number/bool | — | sent by firmware, currently **not stored** |

> **Note on `latitude`/`longitude`:** the firmware sends the JSON literal `null`
> when it has no valid fix (location invalid, < 4 satellites, or HDOP ≥ 3.0), so the
> dashboard never plots a stale/invalid point. The backend writes a `gps_data` row
> only when both values are non-null.

### Status payload — `device/{device_id}/status` (optional)

```json
{ "battery_voltage": 12.6, "signal_strength": -67, "gps_fix": true }
```
Logged with the device id and a timestamp; not persisted.

## Device Authentication Flow

1. The device authenticates to the broker with **username/password over TLS**
   (transport-layer auth).
2. Every telemetry payload includes a **`device_token`**, validated against the
   `devices` table (application-layer auth).
3. A message is accepted only if the device **exists**, is **`enabled = true`**, and
   the token **matches**. Otherwise it is logged and **discarded** (no data written).

Register a device before it can publish (the `devices` table is the source of truth
— no code change needed):
```sql
INSERT INTO devices (device_id, device_name, operator_name, device_token, enabled)
VALUES ('EXCAVATOR_001', 'Excavator 1', 'Operator Name', '<per-device-secret>', true);
```
The same `device_token` must appear in the device's telemetry payloads.

## Ingestion Pipeline (per valid telemetry message)

1. Validate device + `device_token` (existence, `enabled`, token match).
2. Insert into `fuel_data`.
3. Insert into `gps_data` (only if `latitude` and `longitude` are non-null).
4. If `stream_url` present: insert into `camera_data` and broadcast `camera_frame`.
5. Set `devices.status = 'active'`.
6. Call the AI engine for anomaly analysis (fail-safe, 5 s timeout). The AI
   engine uses `timestamp` (forwarded end-to-end from the device payload) to
   compute a burn-rate (L/hour) fuel-drop check; if `timestamp` is absent it
   falls back to a coarser absolute-drop check.
7. On anomaly: insert an `alerts` row, set `devices.status = 'anomaly'`, broadcast `alert_new`.
8. Broadcast `fuel_update` and `gps_update` (the latter only when coordinates were present).

## Camera Images

The camera is **streamed over HTTP from the ESP32-CAM**, not pushed as files. The
device reports its camera URL inside the telemetry payload (`stream_url`, e.g.
`http://<cam-ip>/stream`), which the backend stores and broadcasts.

> **Limitation:** `stream_url` is the camera's **local LAN IP**, so the live stream
> is only reachable when the dashboard client is on the same network as the camera.
> Remote viewing would require a tunnel/relay or a public stream endpoint.

## Reconnect Behavior

- Manual exponential backoff: base `2000 ms`, doubling each attempt.
- Maximum **5 retries**, then the service stops retrying until the process restarts.
- Reconnection never blocks the rest of the backend; the HTTP API and WebSocket stay
  up regardless of broker availability.
