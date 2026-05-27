import React, { useEffect, useState } from 'react';
import { getDevices } from '../services/api';
import socketService from '../services/socket';
import CameraCard from '../components/CameraCard';

export default function Cameras() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await getDevices();
        if (mounted) setDevices(data);
      } catch (e) {
        if (mounted) setError('Failed to load devices');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    // Keep device status badges fresh from live telemetry.
    const onFuel = (d) =>
      setDevices((prev) => prev.map((x) => (x.device_id === d.device_id ? { ...x, status: 'active' } : x)));
    const onAlert = (d) =>
      setDevices((prev) => prev.map((x) => (x.device_id === d.device_id ? { ...x, status: 'anomaly' } : x)));

    socketService.connect();
    socketService.on('fuel_update', onFuel);
    socketService.on('alert_new', onAlert);
    return () => {
      mounted = false;
      socketService.off('fuel_update', onFuel);
      socketService.off('alert_new', onAlert);
    };
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">Camera Viewer</h1>

      {error && <div className="login-error" style={{ maxWidth: 400 }}>{error}</div>}
      {loading && <div className="spinner">Loading cameras…</div>}
      {!loading && devices.length === 0 && (
        <div className="empty-state">No devices registered yet. Cameras appear once a device is registered.</div>
      )}

      <div className="camera-grid">
        {devices.map((d) => (
          <CameraCard key={d.device_id} device={d} />
        ))}
      </div>
    </div>
  );
}
