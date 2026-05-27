# PMJ Fleet Dashboard — EMS (Excavator Monitoring System)

Real-time IoT + AI fuel and GPS monitoring for heavy excavator equipment
(Zoomlion PC300). This monorepo contains the full system across three teams.

## Monorepo Layout

```
/pmj-fleet
  /backend       Node.js + Express gateway, PostgreSQL, MQTT, WebSocket   (Dashboard Dev)
  /frontend      React 18 dashboard (Leaflet map, Recharts analytics)     (Dashboard Dev)
  /ai-engine     Flask Isolation Forest anomaly engine                    (Emilia)
  /iot-device    ESP32 + SIM7600 firmware                                 (Reno)
  /docs          API / MQTT / WebSocket / AI integration contracts
  /.github/workflows  CI for backend, frontend, ai-engine
```

| Folder | Owner |
|--------|-------|
| `/backend` | Dashboard Developer |
| `/frontend` | Dashboard Developer |
| `/ai-engine` | Emilia — AI Engineer |
| `/iot-device` | Reno — IoT Engineer |

## System Architecture

```
ESP32 Devices ──MQTT/TLS 1.3──▶ Node.js Backend ──REST(x-api-key)──▶ Flask AI Engine
                                      │  ▲                                  │
                                      │  └──────── analysis result ─────────┘
                                      │
                                      └──WebSocket──▶ React Dashboard
```

---

## 1. Prerequisites

- **Node.js 18+**
- **PostgreSQL 16**
- **Mosquitto** MQTT broker (TLS 1.3, port 8883)
- **Python 3.10+** (for the AI engine — Emilia's component)

## 2. Backend Setup

```bash
cd backend
cp .env.example .env          # then fill in DB_USER, DB_PASSWORD, JWT_SECRET, AI_API_KEY, etc.
npm install
node seed.js                  # runs migration + creates default admin (admin / admin123)
npm start                     # starts on PORT (default 3000)
```

The migration (`migrations/001_init.sql`) runs automatically on startup using
`CREATE TABLE IF NOT EXISTS`, so no tables are ever dropped.

> **Default login:** `admin` / `admin123` — change this immediately in any real
> deployment.

### Run with PM2

```bash
cd backend
npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs ems-backend
pm2 save
```

## 3. Frontend Setup

```bash
cd frontend
cp .env.example .env          # set REACT_APP_API_URL and REACT_APP_WS_URL
npm install
npm start                     # dev server
npm run build                 # production build into /build
```

---

## 4. Connecting the IoT Device (Reno)

Full details in [docs/MQTT_CONTRACT.md](docs/MQTT_CONTRACT.md).

- Broker: MQTT over **TLS 1.3**, port **8883**, X.509 client cert per device.
- Publish telemetry every 5 min to `device/{device_id}/telemetry`:
  ```json
  { "fuel_level": 420.5, "latitude": -6.2, "longitude": 106.8,
    "engine_status": "running", "voltage": 12.6,
    "timestamp": "2026-05-23T13:17:20.176Z", "device_token": "<token>" }
  ```
- Publish status every 5 min to `device/{device_id}/status`:
  ```json
  { "battery_voltage": 12.6, "signal_strength": -67, "gps_fix": true }
  ```
- Upload camera frames via HTTPS:
  `POST /api/devices/{device_id}/camera/upload`, header `Device-Token: <token>`,
  `multipart/form-data` field `image` (JPEG).

## 5. Connecting the AI Engine (Emilia)

Full details in [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md).

The backend calls the engine over an internal REST API:

```
POST {AI_ENGINE_URL}/internal/ai/analyze          header: x-api-key: <AI_API_KEY>
POST {AI_ENGINE_URL}/internal/ai/analyze/batch
GET  {AI_ENGINE_URL}/health
```

Request / response (single analysis):

```json
// request
{ "device_id": "EX-001", "fuel_level": 20, "timestamp": "2026-05-23T13:17:20.176Z" }

// response
{ "status": "processed", "device_id": "EX-001", "fuel_level": 20,
  "anomaly": true, "risk_level": "MEDIUM", "severity_code": 2,
  "reason": "Anomaly detected by ML model", "anomaly_score": 0.485 }
```

If the engine is unreachable (5 s timeout), the backend uses a fail-safe
response (`anomaly: false`, score `1.0`) and the pipeline continues.

## 6. Adding a New Device

Register the device (and its token) directly in the database — the `devices`
table is the single source of truth, so no code change is needed:

```sql
INSERT INTO devices (device_id, device_name, operator_name, device_token, enabled)
VALUES ('EX-002', 'Excavator 2', 'Operator Name', '<generated-secret-token>', true);
```

- The same `device_token` must appear in the device's telemetry payloads and in
  the `Device-Token` header for camera uploads.
- **`enabled`** controls authorization (default `true`). The backend accepts
  telemetry/uploads only from a device that exists, is `enabled`, and presents
  the matching token; every rejection is recorded in `audit_log` as
  `DEVICE_REJECTED`. To take a device offline, set `enabled = false`:
  ```sql
  UPDATE devices SET enabled = false WHERE device_id = 'EX-002';
  ```
- `status` (`idle` / `active` / `anomaly`) is the live telemetry state only — it
  does **not** affect authorization, so a device is never locked out by going
  into `anomaly`.

---

## Contributing

### Branching Strategy

```
master      stable, production-ready only
release     integration branch for completed features
feature/*   all new work branches off release
```

Feature branch names: `feature/dashboard-ui`, `feature/backend-api`,
`feature/websocket`, `feature/ai-engine`, `feature/iot-device`,
`feature/mqtt-integration`.

- No direct commits to `master` or `release` — everything goes through Pull
  Requests.

### Before merging a `feature/*` branch into `release`
1. Code compiles without errors.
2. All imports resolve correctly.
3. No placeholder functions.
4. No `TODO` comments.
5. No hardcoded secrets.
6. No broken API routes.
7. No `console.log` spam — structured logging only.

### Before merging `release` into `master`
1. Backend APIs tested and returning correct responses.
2. Frontend pages functional and rendering real data.
3. MQTT integration verified with a device connection.
4. AI integration verified with the anomaly detection endpoint.
5. WebSocket real-time updates verified on the dashboard.

## Branch Protection

Configure these manually in **GitHub → Settings → Branches → Add rule**
(repository owner):

**`master`**
- Require a pull request before merging.
- Require status checks to pass before merging — select the `Backend CI`,
  `Frontend CI`, and `AI Engine CI` workflows.
- Disable force pushes.
- Disable direct pushes (do not allow bypassing the PR requirement).

**`release`**
- Require a pull request before merging.
- Disable direct pushes.

## CI/CD

GitHub Actions run per affected path:

| Workflow | Trigger path | Checks |
|----------|--------------|--------|
| `backend.yml` | `backend/**` | `npm ci`, lint, `node --check` on all JS, module-load with `CI=true` (no port bind) |
| `frontend.yml` | `frontend/**` | `npm ci`, lint, `npm run build`, fail if build output empty |
| `ai.yml` | `ai-engine/**` | install requirements (skips gracefully if absent), `py_compile`, dry-run app import |

## Documentation

- [docs/API_CONTRACT.md](docs/API_CONTRACT.md)
- [docs/MQTT_CONTRACT.md](docs/MQTT_CONTRACT.md)
- [docs/WEBSOCKET_EVENTS.md](docs/WEBSOCKET_EVENTS.md)
- [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md)

## Security

- `helmet` security headers with a CSP that allows Leaflet tiles and inline
  styles.
- CORS restricted to `CORS_ORIGIN`.
- All SQL uses parameterized queries — zero string concatenation.
- bcrypt cost factor 12 for password hashing.
- JWT verified on every protected route; 8-hour expiry.
- Rate limit: 100 requests/hour/IP (skips `/internal/*`).
- `/internal/*` is loopback-only (127.0.0.1 / ::1).
- `multer` accepts only `image/jpeg`.
- Audit log records `LOGIN_SUCCESS`, `LOGIN_FAILED`, `ALERT_ACKNOWLEDGED`.
- No stack traces in production error responses.
