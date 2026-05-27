import React, { useEffect, useState, useCallback } from 'react';
import { getDeviceCameraLatest, mediaUrl, cameraStreamUrl } from '../services/api';
import socketService from '../services/socket';

function fmtTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

// Shows the latest camera frame for one device, updating live when a
// camera_frame WebSocket event arrives for that device.
export default function CameraCard({ device }) {
  const [frame, setFrame] = useState(null); // { image_url, timestamp }
  const [loading, setLoading] = useState(true);
  const [imgError, setImgError] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await getDeviceCameraLatest(device.device_id);
      setFrame({ image_url: data.image_url, timestamp: data.timestamp });
      setImgError(false);
    } catch (e) {
      // 404 = no frame captured yet; any other error → also show placeholder.
      setFrame(null);
    } finally {
      setLoading(false);
    }
  }, [device.device_id]);

  useEffect(() => {
    load();

    const onFrame = (data) => {
      if (data.device_id === device.device_id) {
        setFrame({ image_url: data.image_url, timestamp: data.timestamp });
        setImgError(false);
      }
    };

    socketService.connect();
    socketService.on('camera_frame', onFrame);
    return () => socketService.off('camera_frame', onFrame);
  }, [device.device_id, load]);

  // A live stream (absolute http URL in the DB) is served through the backend
  // proxy at a stable same-origin URL — embed it directly so the connection
  // isn't torn down on telemetry updates. Stored snapshots load from /media with
  // a timestamp cache-bust so a new frame at the same path still refreshes.
  const isStream = !!frame && /^https?:\/\//i.test(frame.image_url || '');
  const src = !frame
    ? null
    : isStream
      ? cameraStreamUrl(device.device_id)
      : `${mediaUrl(frame.image_url)}?t=${encodeURIComponent(frame.timestamp || '')}`;
  const time = fmtTime(frame?.timestamp);

  return (
    <div className="camera-card">
      <div className="camera-head">
        <div>
          <div className="device-name">{device.device_name}</div>
          <div className="device-id">{device.device_id}</div>
        </div>
        <span className={`badge ${device.status === 'anomaly' ? 'anomaly-badge' : device.status === 'active' ? 'running' : 'idle'}`}>
          {device.status}
        </span>
      </div>

      <div className="camera-frame">
        {loading ? (
          <div className="camera-placeholder">Loading…</div>
        ) : src && !imgError ? (
          <img className="camera-img" src={src} alt={`${device.device_name} latest frame`} onError={() => setImgError(true)} />
        ) : (
          <div className="camera-placeholder">
            <div className="camera-eye">▣</div>
            <div>Awaiting camera frame…</div>
          </div>
        )}
      </div>

      <div className="camera-foot">{time ? `Captured ${time}` : 'No frame received yet'}</div>
    </div>
  );
}
