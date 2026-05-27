import React from 'react';

const TANK_CAPACITY_L = 600;

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function fmtCoord(v) {
  return v === null || v === undefined ? '—' : Number(v).toFixed(5);
}

export default function FleetStatusCard({ device }) {
  const isAnomaly = device.status === 'anomaly';
  const fuel = device.fuel_level != null ? Number(device.fuel_level) : null;
  const pct = fuel != null ? Math.max(0, Math.min(100, (fuel / TANK_CAPACITY_L) * 100)) : 0;
  const meterClass = pct < 20 ? 'low' : pct < 50 ? 'mid' : '';
  const engine = device.engine_status || 'off';

  return (
    <div className={`fleet-card ${isAnomaly ? 'anomaly' : ''}`}>
      <div className="fleet-card-top">
        <div>
          <div className="device-name">{device.device_name}</div>
          <div className="device-id">{device.device_id}</div>
        </div>
        {isAnomaly ? (
          <span className="badge anomaly-badge">Anomaly Detected</span>
        ) : (
          <span className={`badge ${engine}`}>{engine}</span>
        )}
      </div>

      <div className="row">
        <span>Operator</span>
        <span className="value">{device.operator_name || '—'}</span>
      </div>

      <div style={{ marginTop: 8 }}>
        <div className="row" style={{ marginTop: 0 }}>
          <span>Fuel Level</span>
          <span className="value">{fuel != null ? `${fuel.toFixed(1)} L` : '—'}</span>
        </div>
        <div className="meter">
          <div className={`meter-fill ${meterClass}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="row">
        <span>Battery</span>
        <span className="value">{device.voltage != null ? `${Number(device.voltage).toFixed(2)} V` : '—'}</span>
      </div>
      <div className="row">
        <span>GPS</span>
        <span className="value">
          {fmtCoord(device.latitude)}, {fmtCoord(device.longitude)}
        </span>
      </div>
      <div className="row">
        <span>Last Updated</span>
        <span className="value">{fmtTime(device.last_updated)}</span>
      </div>
    </div>
  );
}
