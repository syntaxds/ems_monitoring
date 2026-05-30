import React, { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
// Bundle Leaflet's stylesheet with the app (same-origin) instead of a CDN link,
// so it is not blocked by the backend's Content-Security-Policy in production.
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [-2.5489, 118.0149]; // Indonesia fallback
const DEFAULT_ZOOM = 5;
const FOCUS_ZOOM = 7;
const PIN_ZOOM = 13;

// Marker color by device status (token-aligned palette).
function statusColor(status) {
  if (status === 'anomaly') return '#e5484d';
  if (status === 'active') return '#46a758';
  return '#8b8b8b'; // idle / off / unknown
}

function hasCoords(d) {
  return d.latitude != null && d.longitude != null;
}

// Keeps the Leaflet view in sync with the computed center/zoom and forces a
// size re-measure whenever the container's real dimensions change (panel/grid
// settling, scrollbar, window resize) so the tile grid always fills the panel.
function MapController({ center, zoom }) {
  const map = useMap();

  useEffect(() => {
    const fix = () => map.invalidateSize({ animate: false });

    let ro;
    const container = map.getContainer();
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fix);
      ro.observe(container);
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(fix));
    const timers = [setTimeout(fix, 300), setTimeout(fix, 900)];
    window.addEventListener('resize', fix);

    return () => {
      if (ro) ro.disconnect();
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', fix);
    };
  }, [map]);

  useEffect(() => {
    map.setView(center, zoom);
  }, [map, center, zoom]);

  return null;
}

// Pans/zooms to a focused device when its id changes (drives list → map sync).
function FocusController({ device }) {
  const map = useMap();
  useEffect(() => {
    if (device && hasCoords(device)) {
      map.flyTo([Number(device.latitude), Number(device.longitude)], PIN_ZOOM, { duration: 0.6 });
    }
  }, [map, device]);
  return null;
}

export default function MapView({ devices, focusId, onMarkerClick }) {
  const located = useMemo(() => devices.filter(hasCoords), [devices]);

  const center = useMemo(() => {
    if (located.length === 0) return DEFAULT_CENTER;
    const lat = located.reduce((s, d) => s + Number(d.latitude), 0) / located.length;
    const lng = located.reduce((s, d) => s + Number(d.longitude), 0) / located.length;
    return [lat, lng];
  }, [located]);

  const zoom = located.length ? FOCUS_ZOOM : DEFAULT_ZOOM;
  const focused = useMemo(
    () => (focusId ? located.find((d) => d.device_id === focusId) : null),
    [focusId, located]
  );

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <MapController center={center} zoom={zoom} />
        <FocusController device={focused} />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {located.map((d) => {
          const isFocus = d.device_id === focusId;
          return (
            <CircleMarker
              key={d.device_id}
              center={[Number(d.latitude), Number(d.longitude)]}
              radius={isFocus ? 11 : 8}
              eventHandlers={onMarkerClick ? { click: () => onMarkerClick(d.device_id) } : undefined}
              pathOptions={{
                color: statusColor(d.status),
                fillColor: statusColor(d.status),
                fillOpacity: 0.85,
                weight: isFocus ? 4 : 2,
              }}
            >
              <Popup>
                <strong>{d.device_name}</strong>
                <br />
                ID: {d.device_id}
                <br />
                Fuel: {d.fuel_level != null ? `${Number(d.fuel_level).toFixed(1)} L` : '—'}
                <br />
                Status: {d.status}
                <br />
                Updated: {d.last_updated ? new Date(d.last_updated).toLocaleString() : '—'}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
