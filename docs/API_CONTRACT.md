# API Contract — EMS Backend

Base URL (development): `http://localhost:3000`

All responses are JSON unless a binary file is streamed (report export).

## Authentication

- Auth scheme: **JWT Bearer token**.
- Obtain a token via `POST /api/auth/login`.
- Send it on every protected request:
  ```
  Authorization: Bearer <token>
  ```
- Token validity: **8 hours** (`JWT_EXPIRES_IN=8h`).
- A `401` response means the token is missing, malformed, or expired — the
  frontend clears the session and redirects to `/login`.
- A `403` response means the token is valid but the role is not permitted.

## Error Response Format

Every error returns:

```json
{ "error": "<message>" }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error (missing/invalid fields) |
| 401 | Missing/invalid/expired token, or bad login credentials |
| 403 | Authenticated but insufficient role, or non-local internal call |
| 404 | Resource not found |
| 429 | Rate limit exceeded — `{ "error": "Too many requests" }` |
| 500 | Internal error (stack traces never exposed in production) |

## Rate Limiting

- **100 requests per hour per IP** across all `/api/*` routes.
- `/internal/*` routes are exempt.
- On limit: HTTP `429` with `{ "error": "Too many requests" }`.

---

## Endpoints

### POST /api/auth/login
Auth: none.

Request:
```json
{ "username": "admin", "password": "admin123" }
```

Response `200`:
```json
{ "token": "<jwt>", "role": "admin", "user_id": 1, "username": "admin" }
```

Failure `401`: `{ "error": "Invalid credentials" }` (identical for unknown
username and wrong password — no user enumeration).

---

### GET /api/devices
Auth: JWT.

Response `200` — array of devices with latest telemetry joined:
```json
[
  {
    "device_id": "EX-001",
    "device_name": "Excavator 1",
    "status": "active",
    "operator_name": "Budi",
    "fuel_level": 420.5,
    "voltage": 12.6,
    "engine_status": "running",
    "latitude": -6.2,
    "longitude": 106.8,
    "last_updated": "2026-05-23T13:17:20.176Z"
  }
]
```

---

### GET /api/devices/:id/fuel?start=&end=
Auth: JWT. `start`/`end` are ISO 8601 datetimes; default = last 24 hours.

Response `200`:
```json
[
  { "fuel_id": 1, "fuel_level": 420.5, "engine_status": "running", "voltage": 12.6, "timestamp": "2026-05-23T13:17:20.176Z" }
]
```

---

### GET /api/devices/:id/gps?start=&end=
Auth: JWT. Default range = last 24 hours.

Response `200`:
```json
[
  { "gps_id": 1, "latitude": -6.2, "longitude": 106.8, "timestamp": "2026-05-23T13:17:20.176Z" }
]
```

---

### GET /api/devices/:id/camera/latest
Auth: JWT.

Response `200`:
```json
{ "image_id": 12, "image_url": "/media/cameras/EX-001_1716470000000_ab12.jpg", "timestamp": "2026-05-23T13:17:20.176Z" }
```
`404` if no image exists for the device.

---

### POST /api/devices/:id/camera/upload
Auth: **`Device-Token` header** (matched against `devices.device_token`).
Content-Type: `multipart/form-data`, field name `image`.

- Only `image/jpeg` is accepted; max size from `MAX_IMAGE_SIZE_MB` (default 15 MB).
- On success broadcasts a `camera_frame` WebSocket event.

Headers:
```
Device-Token: <token>
```

Response `201`:
```json
{ "status": "stored", "image_id": 12 }
```
`401` missing token, `403` invalid token, `400` no/invalid file.

---

### GET /api/alerts?status=&device_id=
Auth: JWT. `status` defaults to `active`. Ordered by severity (high first) then
newest first.

Response `200`:
```json
[
  {
    "alert_id": 5, "device_id": "EX-001", "alert_type": "fuel_anomaly",
    "alert_message": "Anomaly detected by ML model", "severity": "high",
    "status": "active", "timestamp": "2026-05-23T13:17:20.176Z",
    "device_name": "Excavator 1"
  }
]
```

---

### PUT /api/alerts/:id/acknowledge
Auth: JWT, role **admin** or **supervisor**.

Response `200`: `{ "status": "ACKNOWLEDGED" }`
`404` if the alert does not exist or is already acknowledged.
Writes an `ALERT_ACKNOWLEDGED` row to `audit_log`.

---

### POST /api/reports/generate
Auth: JWT. Streams a file (no disk write).

Request:
```json
{ "device_id": "EX-001", "start_date": "2026-05-01", "end_date": "2026-05-23", "format": "pdf" }
```
- `device_id` optional — omit for a fleet-wide report.
- `format`: `"pdf"` or `"csv"`.

Response `200`: binary stream with
`Content-Disposition: attachment; filename="ems_report_<stamp>.<ext>"`.
The frontend requests this with `responseType: 'blob'`.

---

### POST /internal/ai/analyze · /internal/ai/analyze/batch · GET /internal/ai/health
Auth: **loopback only** (127.0.0.1 / ::1). Not rate limited. Never reachable
from the frontend. Proxies to the external AI engine — see
[AI_INTEGRATION.md](AI_INTEGRATION.md).
