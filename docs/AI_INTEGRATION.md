# AI Integration Contract — EMS

How the Node.js backend integrates with the Flask AI engine (Emilia's
component) for fuel anomaly detection.

## Architecture

```
ESP32 Devices
    │  MQTT TLS 1.3
    ▼
Node.js Backend (Gateway Layer)
    │  Internal REST API (x-api-key)
    ▼
Flask AI Engine (Isolation Forest)
    │  Analysis Result
    ▼
Node.js Backend
    │  WebSocket
    ▼
React Dashboard
```

**The React frontend never talks to the AI engine directly.** All AI traffic
flows through the Node.js backend. The AI endpoints are not exposed to browser
clients.

## Base URL & Endpoints

Configured in the backend `.env`:

```
AI_ENGINE_URL=http://10.244.59.239:5001
AI_API_KEY=
AI_ANOMALY_THRESHOLD=0.75
```

The backend calls:

```
POST {AI_ENGINE_URL}/internal/ai/analyze
POST {AI_ENGINE_URL}/internal/ai/analyze/batch
GET  {AI_ENGINE_URL}/health
```

## Authentication

Every request from the backend to the AI engine includes:

```
x-api-key: <AI_API_KEY>
```

The key is read from the environment and is never hardcoded in source.

## Single Analysis

### Request
```json
{
  "device_id": "EX-001",
  "fuel_level": 20,
  "timestamp": "2026-05-23T13:17:20.176Z"
}
```
`timestamp` is always ISO 8601 UTC.

### Response
```json
{
  "status": "processed",
  "timestamp": "2026-05-23T13:55:05.711Z",
  "device_id": "EX-001",
  "fuel_level": 20,
  "anomaly": true,
  "risk_level": "MEDIUM",
  "severity_code": 2,
  "reason": "Anomaly detected by ML model",
  "anomaly_score": 0.485
}
```

## Batch Analysis

### Request
```json
{
  "devices": [
    { "device_id": "EX-001", "fuel_level": 20 },
    { "device_id": "EX-002", "fuel_level": 50 }
  ]
}
```
Returns an array of per-device result objects in the single-analysis shape.

## Anomaly Score Interpretation

The engine uses **inverted normalized scoring** — a higher score means *more
normal*.

| Score Range | Meaning |
|-------------|---------|
| 0.8 – 1.0 | NORMAL |
| 0.4 – 0.7 | WARNING |
| 0.0 – 0.3 | ANOMALY |

- `1.0` = fully normal behavior
- `0.0` = highest anomaly risk

The dashboard uses this scheme for gauges, charts, status indicators, alert
highlighting, and fleet risk visualization.

> Threshold note: `AI_ANOMALY_THRESHOLD=0.75` is available for score-based
> gating. The authoritative anomaly signal is the boolean `anomaly` field
> returned by the engine; the backend creates an alert whenever `anomaly` is
> `true`.

## Risk Level Rules

| Condition | Risk Level |
|-----------|------------|
| `fuel_level < 10` | HIGH |
| `fuel_level > 100` | HIGH |
| sudden fuel drop > 15 | HIGH |
| Isolation Forest anomaly detected | MEDIUM |
| Normal fuel usage | LOW |

## Severity Code Mapping

| Severity Code | Risk Level | DB severity |
|---------------|------------|-------------|
| 1 | LOW | `low` |
| 2 | MEDIUM | `medium` |
| 3 | HIGH | `high` |

The backend maps `severity_code` → DB `severity` when inserting alerts.

## Alert Creation Logic (backend, on each telemetry message)

```js
const aiResult = await aiService.analyze(deviceId, fuelLevel, timestamp);

if (aiResult.anomaly === true) {
  const severityMap = { 1: 'low', 2: 'medium', 3: 'high' };
  const severity = severityMap[aiResult.severity_code] || 'medium';

  // INSERT INTO alerts (...) and UPDATE devices SET status='anomaly'
  // then broadcast 'alert_new' over WebSocket.
}
```

## Fail-Safe Behavior

Timeout: **5 seconds**. If the AI engine is unreachable, errors, or times out:

- Telemetry insertion continues.
- GPS insertion continues.
- The MQTT pipeline continues.
- WebSocket updates continue.
- The dashboard stays fully functional.
- The error is logged: `[AI] analyze for <device> failed: <message>`.
- Authentication failures (the engine rejects our key with HTTP 401/403) are
  logged distinctly as `[AI][AUTH] … invalid or missing AI_API_KEY`.

Fallback response used when the AI engine is down:

```json
{
  "anomaly": false,
  "risk_level": "LOW",
  "severity_code": 1,
  "reason": "AI service unavailable",
  "anomaly_score": 1.0
}
```

Because the fallback reports `anomaly: false` with score `1.0` (fully normal),
a downed AI engine never produces false alerts and never blocks ingestion. The
backend catches all AI errors and continues — it never crashes on AI failure.

## Device Validation Responsibility Split

**Backend responsibilities** (enforced before any DB insert or AI call):
- Validate device existence in the PostgreSQL `devices` table.
- Validate the device is authorized via the `enabled` flag.
- Validate `device_token` matches the stored token.
- Reject unknown / disabled / bad-token devices **before** AI inference.
- Log every rejection to `audit_log` with action `DEVICE_REJECTED`.
- Log invalid AI-engine API-key attempts (`[AI][AUTH]`).

**AI Engine responsibilities**:
- Anomaly inference only — no authorization, no device management.

This separation must be preserved across all services.

### Database-driven validation (single source of truth)

Device validation uses a PostgreSQL lookup only — no device ids or tokens are
hardcoded anywhere. New devices are added by inserting a row into `devices`
(see README); no code change is required.

`validateDevice(deviceId, deviceToken)` lives in
`backend/services/deviceAuth.js` and is used by **both** the MQTT telemetry
handler and the camera-upload route:

```
SELECT device_id, device_token, enabled FROM devices WHERE device_id = $1
  → no row        → audit DEVICE_REJECTED "Unknown device_id"        → reject
  → enabled=false → audit DEVICE_REJECTED "Disabled device"          → reject
  → token != stored → audit DEVICE_REJECTED "Invalid token for device" → reject
  → otherwise     → authorized
```

> **Authorization vs. live status:** the gate uses the dedicated **`enabled`**
> boolean (default `true`), *not* the live `status` field. `status`
> (`idle` / `active` / `anomaly`) reflects only current telemetry state, so a
> device is never locked out by going into `anomaly`. To take a device offline,
> set `enabled = false`.

## Health Check

`GET {AI_ENGINE_URL}/health` (with `x-api-key`, 3 s timeout) returns the
engine's status payload, or `{ "status": "unreachable", "error": "<message>" }`
when it cannot be reached. Exposed internally as `GET /internal/ai/health`.
