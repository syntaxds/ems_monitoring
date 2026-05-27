# MQTT Contract — EMS Device Ingestion

This contract governs how IoT devices (ESP32 + SIM7600) publish telemetry to
the EMS backend gateway.

## Broker Connection

| Property | Value |
|----------|-------|
| Protocol | MQTT over TLS **1.3** |
| Port | `8883` |
| Host | `MQTT_HOST` (from backend `.env`) |
| Client auth | X.509 client certificate **per device** |
| QoS | 1 |

TLS material is configured on the backend via:
```
MQTT_CA_CERT=./certs/ca.crt
MQTT_CLIENT_CERT=./certs/client.crt
MQTT_CLIENT_KEY=./certs/client.key
```

## Topics

| Topic | Publisher | Frequency |
|-------|-----------|-----------|
| `device/{device_id}/telemetry` | Device | every 5 minutes |
| `device/{device_id}/status` | Device | every 5 minutes |

The backend subscribes with wildcards: `device/+/telemetry`, `device/+/status`.

### Telemetry payload — `device/{device_id}/telemetry`

```json
{
  "fuel_level": 420.5,
  "latitude": -6.200000,
  "longitude": 106.816666,
  "engine_status": "running",
  "voltage": 12.6,
  "timestamp": "2026-05-23T13:17:20.176Z",
  "device_token": "<per-device-secret>"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `fuel_level` | number | litres |
| `latitude` | number | decimal degrees (optional but recommended) |
| `longitude` | number | decimal degrees (optional but recommended) |
| `engine_status` | string | `running` \| `idle` \| `off` |
| `voltage` | number | battery volts |
| `timestamp` | string | ISO 8601 UTC |
| `device_token` | string | **required** — validated against `devices.device_token` |

### Status payload — `device/{device_id}/status`

```json
{
  "battery_voltage": 12.6,
  "signal_strength": -67,
  "gps_fix": true
}
```

The backend logs status messages with the device id and a timestamp; they are
not persisted.

## Device Authentication Flow

1. The device presents a valid **X.509 client certificate** during the TLS 1.3
   handshake (transport-layer auth).
2. Every telemetry payload includes a **`device_token`** that the backend
   validates against the `devices` table (application-layer auth).
3. If the device is not registered, or the token does not match, the message is
   **logged and discarded** — no data is written.

## Ingestion Pipeline (per valid telemetry message)

1. Validate device + `device_token`.
2. Insert into `fuel_data`.
3. Insert into `gps_data` (if lat/lon present).
4. Set `devices.status = 'active'`.
5. Call the AI engine for anomaly analysis (fail-safe, 5 s timeout).
6. On anomaly: insert `alerts` row, set `devices.status = 'anomaly'`, broadcast
   `alert_new`.
7. Broadcast `fuel_update` and `gps_update` over WebSocket.

## Reconnect Behavior

- Manual exponential backoff: base `2000 ms`, doubling each attempt.
- Maximum **5 retries**, then the service stops retrying until the process
  restarts.
- Reconnection never blocks the rest of the backend; the HTTP API and WebSocket
  stay up regardless of broker availability.

## Camera Images

Camera frames are **not** sent over MQTT. They are uploaded via HTTPS:
`POST /api/devices/{device_id}/camera/upload` with header `Device-Token: <token>`
and `multipart/form-data` field `image` (JPEG). See
[API_CONTRACT.md](API_CONTRACT.md).
