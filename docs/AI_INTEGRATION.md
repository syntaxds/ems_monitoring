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
  "fuel_level": 180,
  "timestamp": "2026-05-23T13:17:20.176Z"
}
```
`fuel_level` must be **litres** (0–249.75 for a PC135-class tank) for the
rules below to be meaningful — the engine's thresholds, training data, and
`MAX_FUEL_LEVEL` constant are all calibrated on litres, not a 0–100
percentage.

> **Known contract gap (unresolved, backend-side):** as of this writing, the
> backend (`mqttService.js` / `internal.js`, owned by the backend team) still
> prefers `fuel_pct` (a 0–100 percentage) over `fuel_level` when calling this
> endpoint. Until that's changed on the backend side, the burn-rate check
> below receives percentage-scaled input and its L/h math will be off by the
> tank-capacity factor. This needs to be coordinated with whoever owns
> `backend/services/mqttService.js` and `backend/routes/internal.js` — not
> something the AI engine can fix unilaterally.

`timestamp` is always ISO 8601 UTC, and should be sent on every request: it
anchors the burn-rate (L/hour) fuel-drop check described below. If omitted or
malformed, the engine falls back to a coarser absolute-drop check instead (see
Risk Level Rules).

### Response
```json
{
  "status": "processed",
  "timestamp": "2026-05-23T13:55:05.711Z",
  "device_id": "EX-001",
  "fuel_level": 180,
  "anomaly": true,
  "risk_level": "HIGH",
  "severity_code": 3,
  "reason": "Fuel burn rate 42.3 L/h exceeds physical ceiling for this engine class",
  "anomaly_score": 0.485
}
```

## Batch Analysis

### Request
```json
{
  "devices": [
    { "device_id": "EX-001", "fuel_level": 180 },
    { "device_id": "EX-002", "fuel_level": 95 }
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
| `fuel_level < 0` or `> 249.75` (`MAX_FUEL_LEVEL`) | HIGH — invalid sensor reading |
| `fuel_level < 10` | LOW — treated as an expected low-fuel state, no alert |
| `voltage < 12.0` | MEDIUM — low voltage |
| fuel drop > 5 L while `engine_status == "off"` | HIGH — engine-off fuel drop |
| burn rate > 25 L/h while running (PC135-class ceiling) | HIGH |
| burn rate > 20 L/h while running | MEDIUM (HIGH if corroborated by the ML model) |
| burn rate > 8 L/h while `engine_status == "idle"` (idle ceiling) | HIGH — `idle_fuel_drop` |
| burn rate > 5 L/h while `engine_status == "idle"` | MEDIUM (HIGH if ML-corroborated) — `idle_fuel_drop` |
| continuous `engine_status == "idle"` for > 30 minutes | MEDIUM — `idle_duration_exceeded` |
| `timestamp` missing/malformed and single-step drop > 15 L | MEDIUM (HIGH if ML-corroborated) — degraded-mode fallback, no rate available |
| Isolation Forest flags an unusual `(fuel, voltage)` point | LOW — informational only, does not create an alert by itself |
| Normal fuel usage | LOW |

The burn-rate check requires at least two readings for a device and
`timestamp` on each request; it's computed from the oldest reading still held
in that device's rolling history window (up to 30 readings), not just the
immediately previous one, so a single noisy sample can't swing the rate.

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
