import React, { useEffect, useState, useCallback } from 'react';
import { getDevices } from '../services/api';
import socketService from '../services/socket';
import MapView from '../components/MapView';
import FleetStatusCard from '../components/FleetStatusCard';

export default function Overview() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await getDevices();
      setDevices(data);
    } catch (e) {
      setError('Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    // Merge a partial update into the matching device.
    const applyUpdate = (deviceId, patch) => {
      setDevices((prev) =>
        prev.map((d) => (d.device_id === deviceId ? { ...d, ...patch } : d))
      );
    };

    const onFuel = (data) =>
      applyUpdate(data.device_id, {
        fuel_level: data.fuel_level,
        engine_status: data.engine_status,
        voltage: data.voltage,
        status: 'active',
        last_updated: data.timestamp
      });

    const onGps = (data) =>
      applyUpdate(data.device_id, {
        latitude: data.latitude,
        longitude: data.longitude,
        last_updated: data.timestamp
      });

    const onAlert = (data) =>
      applyUpdate(data.device_id, { status: 'anomaly' });

    socketService.connect();
    socketService.on('fuel_update', onFuel);
    socketService.on('gps_update', onGps);
    socketService.on('alert_new', onAlert);

    return () => {
      socketService.off('fuel_update', onFuel);
      socketService.off('gps_update', onGps);
      socketService.off('alert_new', onAlert);
    };
  }, [load]);

  const total = devices.length;
  const active = devices.filter((d) => d.status === 'active').length;
  const idle = devices.filter((d) => d.status === 'idle').length;
  const anomalies = devices.filter((d) => d.status === 'anomaly').length;

  return (
    <div className="page">
      <h1 className="page-title">Fleet Overview</h1>

      <div className="summary-grid">
        <div className="summary-card">
          <div className="label">Total Devices</div>
          <div className="value">{total}</div>
        </div>
        <div className="summary-card accent-green">
          <div className="label">Active</div>
          <div className="value">{active}</div>
        </div>
        <div className="summary-card accent-grey">
          <div className="label">Idle</div>
          <div className="value">{idle}</div>
        </div>
        <div className="summary-card accent-red">
          <div className="label">Anomalies</div>
          <div className="value">{anomalies}</div>
        </div>
      </div>

      {error && <div className="login-error" style={{ maxWidth: 400 }}>{error}</div>}

      <div className="overview-cols">
        <div className="panel">
          <div className="panel-header">Live Fleet Map</div>
          <MapView devices={devices} />
        </div>

        <div className="panel">
          <div className="panel-header">Devices ({total})</div>
          <div className="fleet-list">
            {loading && <div className="spinner">Loading devices…</div>}
            {!loading && devices.length === 0 && (
              <div className="empty-state">No devices registered yet.</div>
            )}
            {devices.map((d) => (
              <FleetStatusCard key={d.device_id} device={d} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
