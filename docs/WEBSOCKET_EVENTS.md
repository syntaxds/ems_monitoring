# WebSocket Events — EMS Real-Time Channel

The backend pushes live updates to the dashboard over a single WebSocket that
shares the HTTP server port.

## Connection

| Property | Value |
|----------|-------|
| Endpoint | `ws://<host>:<port>/ws` (`wss://` behind TLS) |
| Frontend env | `REACT_APP_WS_URL=ws://localhost:3000/ws` |
| Library (server) | `ws` |
| Library (client) | native `WebSocket` |

On connect, the server immediately sends a `connected` event.

## Message Envelope

Every message is JSON with this shape:

```json
{ "event": "<name>", "data": { ... } }
```

## Events

### connected
Sent once on connection.
```json
{ "event": "connected", "data": { "server_time": "2026-05-23T13:17:20.176Z" } }
```

### fuel_update
```json
{
  "event": "fuel_update",
  "data": {
    "device_id": "EX-001",
    "fuel_level": 420.5,
    "engine_status": "running",
    "voltage": 12.6,
    "timestamp": "2026-05-23T13:17:20.176Z"
  }
}
```

### gps_update
```json
{
  "event": "gps_update",
  "data": {
    "device_id": "EX-001",
    "latitude": -6.2,
    "longitude": 106.8,
    "timestamp": "2026-05-23T13:17:20.176Z"
  }
}
```

### camera_frame
```json
{
  "event": "camera_frame",
  "data": {
    "device_id": "EX-001",
    "image_url": "/media/cameras/EX-001_1716470000000_ab12.jpg",
    "timestamp": "2026-05-23T13:17:20.176Z"
  }
}
```

### alert_new
```json
{
  "event": "alert_new",
  "data": {
    "alert_id": 5,
    "device_id": "EX-001",
    "alert_type": "fuel_anomaly",
    "alert_message": "Anomaly detected by ML model",
    "severity": "high",
    "risk_level": "HIGH",
    "anomaly_score": 0.12,
    "timestamp": "2026-05-23T13:17:20.176Z"
  }
}
```

## Frontend Subscription Pattern

The client wrapper (`src/services/socket.js`) exposes:

```js
import socketService from './services/socket';

socketService.connect();                 // idempotent; safe to call repeatedly
socketService.on('fuel_update', handler); // register
socketService.off('fuel_update', handler);// unregister (do this on unmount)
socketService.onStatusChange(isConnected => { ... }); // connection dot
socketService.disconnect();              // on logout
```

A typical React page registers handlers in `useEffect` and unregisters them in
the cleanup function so handlers never leak across mounts.

## Reconnect Behavior

- On unexpected close, the client reconnects with exponential backoff:
  base `1000 ms`, doubling up to a `30000 ms` ceiling.
- `disconnect()` (called on logout) stops reconnection.
- The connection-status dot in the header reflects the live socket state
  (green = OPEN, red = closed/connecting).
