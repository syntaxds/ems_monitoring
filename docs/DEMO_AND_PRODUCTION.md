# Demo Data & Production Cutover — PMJ Fleet Dashboard

This document explains (1) how the dashboard is populated for demonstration and
the project paper so that **every feature and every status renders as working**,
and (2) the single command to wipe all demo data and switch to real, connected
devices.

> **Audit note:** the application code contains **no hardcoded, mock, or dummy
> data**. Every page is driven entirely by the REST API and the live WebSocket
> stream, which read from PostgreSQL. The only "demo" content lives in seedable
> database rows produced by `scripts/seedDemo.js` — never in the source code.
> URLs in `frontend/src/services/*` use `process.env.*` with a `localhost`
> fallback (standard config), and the map uses the real OpenStreetMap tile
> service. Nothing else is fabricated in code.

---

## 1. Seeding the full-state demo

From the `backend/` directory:

```bash
npm run seed:demo
```

This is **idempotent** — re-running clears and rebuilds the managed demo dataset.
It never touches the `users` table and never touches devices whose id does not
belong to the managed demo fleet.

### What gets created

5 devices, shaped so that the dashboard exercises every state:

| Device          | status   | engine  | GPS | Camera  | Fuel curve  | Demonstrates |
|-----------------|----------|---------|-----|---------|-------------|--------------|
| `EXCAVATOR_001` | active   | running | yes | online  | refuel step | normal op + refuel event + a medium alert |
| `DEMO-EXC-02`   | idle     | idle    | yes | online  | gentle drain| idle status, engine idle |
| `DEMO-EXC-03`   | anomaly  | running | yes | offline | theft drop  | anomaly status, HIGH+MEDIUM alerts, red chart marker, offline camera |
| `DEMO-EXC-04`   | active   | off     | yes | online  | flat-high   | engine off while active, LOW alert |
| `DEMO-EXC-05`   | idle     | off     | no  | offline | flat-low    | un-located device, low fuel, offline camera, unassigned operator |

Each device gets **24 h of telemetry at a 5-minute cadence** (288 fuel samples;
GPS for located devices), a camera frame for "online" devices, and the alerts
below.

### Status / feature coverage matrix

| Dimension | Values exercised |
|-----------|------------------|
| `device.status` | `active`, `idle`, `anomaly` |
| `engine_status` | `running`, `idle`, `off` |
| GPS | located (map markers + centroid) **and** not-located ("X of Y located") |
| Camera | online (served frame) **and** offline ("No signal") |
| `alert.severity` | `high`, `medium`, `low` — all `active`/unacknowledged |
| Fuel chart | steady drain, **refuel step** (Refuel events), **sharp drop** (anomaly marker) |
| Voltage | realistic 12.0–12.7 V per sample |

### Where each page lights up

- **Overview** — KPI strip (fleet total / active / idle / anomalies), live map
  with markers + centroid, searchable/filterable device list with fuel bars,
  voltage, engine pills, and the anomaly dot.
- **Fuel** — per-device level chart (drain + refuel + theft drop), Current level,
  Fuel burned, Burn rate (uses `engine_status='running'`), Refuel events, hourly
  consumption bars, and the refuel/anomaly event list.
- **Alerts** — High/Medium/Low KPI counts, severity filter chips, list + detail
  pane with anomaly score bar, timeline, AI reasoning, and Acknowledge / Ack-all.
- **Cameras** — online/offline tiles, anomaly badge, grid/wall layouts, the
  online/offline/anomaly filters, and the full-screen modal.
- **Export** — device snapshot preview, status filter, date presets, CSV/PDF
  generation (writes a row to `reports`).
- **Shell** — the sidebar alert badge and top-bar "Live" indicator reflect the
  seeded active-alert count and WebSocket connection.

### After seeding

Just **refresh the dashboard** (no backend restart needed). To see the live
WebSocket path as well, the backend must be running and — for AI anomaly
detection on new telemetry — the AI engine container should be up (see
`Dockerfile.ai-engine`).

---

## 2. Production cutover — remove all demo data, go live

When you are ready to run against **real, connected devices only**, brief me with:

> **"Run the production cutover"**  (or just run `npm run cutover`)

That triggers `backend/scripts/cutover.js`, which in a single transaction:

1. Deletes every `DEMO-*` device and all of its telemetry / alerts / frames.
2. Clears **all** remaining telemetry (`fuel_data`, `gps_data`, `camera_data`)
   and **all** alerts, so real devices start from a clean slate.
3. Resets every surviving real device's live `status` to `idle`.
4. Deletes demo camera image files from the upload directory.

It **keeps**: the `users` table (logins), all real devices (any id not starting
with `DEMO-`) including their `device_token` and `enabled` flag, plus
`audit_log` and `reports` history.

```bash
npm run cutover
```

### Going fully live after cutover

1. Ensure each physical device has a row in `devices` with a matching
   `device_token` and `enabled = true` (the MQTT pipeline rejects unknown,
   disabled, or bad-token devices — see `docs/AI_INTEGRATION.md`).
2. Confirm backend `.env`: `MQTT_HOST/USER/PASS`, `DB_*`, `AI_ENGINE_URL`,
   `AI_API_KEY`.
3. Start the AI engine (`Dockerfile.ai-engine`) and the backend (`npm start`).
4. Power on the devices — telemetry flows over MQTT → backend → DB → dashboard,
   and anomalies are scored by the AI engine in real time.

> Note: `EXCAVATOR_001` is treated as the real registered device and is **kept**
> by cutover (only its demo telemetry/alerts are cleared). If it is not a real
> device in your deployment, delete its row manually after cutover.
