import React, { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDevices, getDeviceCameraLatest, mediaUrl, controlDeviceCamera } from '../services/api';
import socketService from '../services/socket';
import Icon from '../components/ui/Icon';
import { PageHeader, Segmented, FilterChips, Pill, Dot, EmptyState } from '../components/ui';
import { fmtTime, fmtRelative } from '../lib/format';

// Cameras publish periodic JPEG snapshots over MQTT (device/{id}/camera); the
// backend stores each frame under /media/cameras and pushes a camera_frame
// WebSocket event with the new path. A tile is just a single still image that
// swaps in whenever a fresher frame arrives — cheap, so it renders immediately.
// One-shot snapshot <img> src (cache-busted by timestamp).
function snapshotSrc(frame) {
  if (!frame || !frame.image_url) return null;
  return `${mediaUrl(frame.image_url)}?t=${encodeURIComponent(frame.timestamp || '')}`;
}

export default function Cameras() {
  const { user } = useAuth();
  const [devices, setDevices] = useState([]);
  const [frames, setFrames] = useState({}); // device_id -> { image_url, timestamp }
  const [paused, setPaused] = useState({}); // device_id -> boolean
  const [layout, setLayout] = useState('grid');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadFrame = useCallback(async (deviceId) => {
    try {
      const { data } = await getDeviceCameraLatest(deviceId);
      setFrames((prev) => ({ ...prev, [deviceId]: { image_url: data.image_url, timestamp: data.timestamp } }));
    } catch (e) {
      setFrames((prev) => ({ ...prev, [deviceId]: null }));
    }
  }, []);

  const loadAll = useCallback(
    async (list) => {
      await Promise.allSettled(list.map((d) => loadFrame(d.device_id)));
    },
    [loadFrame]
  );

  const handleTogglePause = useCallback(async (deviceId, currentlyPaused) => {
    const action = currentlyPaused ? 'resume' : 'pause';
    setPaused((prev) => ({ ...prev, [deviceId]: !currentlyPaused }));
    try {
      await controlDeviceCamera(deviceId, action);
    } catch (e) {
      setPaused((prev) => ({ ...prev, [deviceId]: currentlyPaused }));
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await getDevices();
        if (!mounted) return;
        setDevices(data);
        const pauseMap = {};
        data.forEach((d) => {
          pauseMap[d.device_id] = !!d.camera_paused;
        });
        setPaused(pauseMap);
        loadAll(data);
      } catch (e) {
        if (mounted) setDevices([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const onFrame = (data) => {
      setFrames((prev) => ({ ...prev, [data.device_id]: { image_url: data.image_url, timestamp: data.timestamp } }));
    };
    const onFuel = (d) =>
      setDevices((prev) => prev.map((x) => (x.device_id === d.device_id ? { ...x, status: 'active' } : x)));
    const onAlert = (d) =>
      setDevices((prev) => prev.map((x) => (x.device_id === d.device_id ? { ...x, status: 'anomaly' } : x)));
    const onControl = (d) =>
      setPaused((prev) => ({ ...prev, [d.device_id]: d.camera_paused }));

    socketService.connect();
    socketService.on('camera_frame', onFrame);
    socketService.on('fuel_update', onFuel);
    socketService.on('alert_new', onAlert);
    socketService.on('camera_control', onControl);
    return () => {
      mounted = false;
      socketService.off('camera_frame', onFrame);
      socketService.off('fuel_update', onFuel);
      socketService.off('alert_new', onAlert);
      socketService.off('camera_control', onControl);
    };
  }, [loadAll]);

  // A device counts as "available" if it has a stored snapshot frame.
  const isAvailable = (d) => !!(frames[d.device_id] && frames[d.device_id].image_url);
  const available = devices.filter(isAvailable).length;

  const filtered = devices.filter((d) => {
    if (filter === 'online') return isAvailable(d);
    if (filter === 'offline') return !isAvailable(d);
    if (filter === 'anomaly') return d.status === 'anomaly';
    return true;
  });

  const idx = selected ? devices.findIndex((d) => d.device_id === selected.device_id) : -1;
  const openRel = (delta) => {
    if (idx < 0) return;
    setSelected(devices[(idx + delta + devices.length) % devices.length]);
  };

  if (user?.role === 'driver') {
    return <Navigate to="/shift-start" replace />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cameras"
        subtitle="Latest snapshot per device, refreshed automatically as new frames arrive over MQTT."
        right={
          <span>
            {available} / {devices.length} available
          </span>
        }
        actions={
          <>
            <Segmented
              value={layout}
              onChange={setLayout}
              size="sm"
              options={[
                { value: 'grid', label: 'Grid' },
                { value: 'wall', label: 'Wall' },
              ]}
            />
            <button className="btn btn-ghost" onClick={() => loadAll(devices)}>
              <Icon name="refresh" size={13} />
              Refresh all
            </button>
          </>
        }
      />

      <div className="card flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: devices.length },
            { value: 'online', label: 'Available', count: available },
            { value: 'offline', label: 'Offline', count: devices.length - available },
            { value: 'anomaly', label: 'Anomaly', count: devices.filter((d) => d.status === 'anomaly').length },
          ]}
        />
        <div className="flex items-center gap-2 text-[12px] text-ink3">
          <Dot color="var(--success)" size={6} pulse />
          Live · {fmtTime(Date.now())}
        </div>
      </div>

      {loading && <div className="card card-pad text-center text-ink3 text-[13px]">Loading cameras…</div>}

      <div
        className={
          layout === 'grid'
            ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4'
            : 'grid grid-cols-1 md:grid-cols-2 gap-3'
        }
      >
        {!loading &&
          filtered.map((d) => (
            <CameraTile
              key={d.device_id}
              device={d}
              frame={frames[d.device_id]}
              paused={paused[d.device_id]}
              onOpen={() => setSelected(d)}
              onTogglePause={() => handleTogglePause(d.device_id, paused[d.device_id])}
            />
          ))}
        {!loading && filtered.length === 0 && (
          <div className="col-span-full card">
            <EmptyState
              icon="camera"
              title="No cameras match this filter"
              hint={devices.length === 0 ? 'No devices registered yet.' : 'Switch filters or wait for the next frame.'}
            />
          </div>
        )}
      </div>

      {selected && (
        <CameraModal
          device={selected}
          frame={frames[selected.device_id]}
          paused={paused[selected.device_id]}
          onClose={() => setSelected(null)}
          onPrev={() => openRel(-1)}
          onNext={() => openRel(1)}
          onTogglePause={() => handleTogglePause(selected.device_id, paused[selected.device_id])}
        />
      )}
    </div>
  );
}

function CameraOffline() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-ink3 gap-2" style={{ background: '#0a0a0a' }}>
      <Icon name="wifiOff" size={26} />
      <div className="text-[12px] font-medium text-ink2">No signal</div>
      <div className="text-[11px] text-ink3">Awaiting camera frame…</div>
    </div>
  );
}

// Renders the actual pixels — the latest stored snapshot for this device.
function CameraFeed({ device, frame }) {
  const [imgError, setImgError] = useState(false);
  const frameUrl = frame && frame.image_url;

  // Reset the error state whenever a fresh snapshot arrives.
  useEffect(() => {
    setImgError(false);
  }, [frameUrl]);

  const src = snapshotSrc(frame);
  if (!src || imgError) return <CameraOffline />;
  return (
    <img
      src={src}
      alt={`${device.device_name} latest frame`}
      className="absolute inset-0 w-full h-full object-cover"
      onError={() => setImgError(true)}
    />
  );
}

function CameraTile({ device, frame, paused, onOpen, onTogglePause }) {
  const hasFrame = !!(frame && frame.image_url);
  const isAnom = device.status === 'anomaly';

  // Top-left status badge reflects whether a frame has arrived yet and pause state.
  let badge = { label: 'Offline' };
  if (hasFrame) {
    badge = paused ? { label: 'Paused' } : { label: 'Snapshot' };
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      className="card overflow-hidden text-left group flex flex-col cursor-pointer"
      style={{ borderColor: isAnom ? 'color-mix(in oklch, var(--danger) 50%, var(--border))' : 'var(--border)' }}
    >
      <div className="relative aspect-video overflow-hidden" style={{ background: '#0a0a0a' }}>
        <CameraFeed device={device} frame={frame} />

        {/* Top HUD */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between text-[11px]">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-white/70 font-medium"
              style={{
                background: paused ? 'var(--warning)' : 'rgba(0,0,0,0.55)',
                color: paused ? 'var(--ink)' : 'white/70',
              }}
            >
              {badge.label}
            </span>
            {isAnom && (
              <span className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-white font-medium" style={{ background: 'var(--danger)' }}>
                Anomaly
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {frame?.timestamp && (
              <span className="text-white/85 px-1.5 h-[20px] inline-flex items-center rounded-md mono tnum" style={{ background: 'rgba(0,0,0,0.45)' }}>
                {fmtTime(frame.timestamp)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="p-3 flex items-center justify-between gap-3 bg-surface">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium truncate">{device.device_name}</span>
            <span className="mono text-[11px] text-ink3">{device.device_id}</span>
          </div>
          <div className="text-[11.5px] text-ink3 truncate mt-0.5">
            {device.operator_name || 'Unassigned'}
            {device.site ? ` · ${device.site}` : ''}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-ink3">
          <span className="text-[11px]">{frame?.timestamp ? fmtRelative(frame.timestamp) : '—'}</span>
          <button
            className="btn btn-icon btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePause();
            }}
            title={paused ? 'Resume snapshot' : 'Pause snapshot'}
          >
            <Icon name={paused ? 'play' : 'pause'} size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CameraModal({ device, frame, paused, onClose, onPrev, onNext, onTogglePause }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="card max-w-5xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 h-[52px] border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon name="camera" size={15} className="text-ink2" />
            <span className="text-[14px] font-semibold">{device.device_name}</span>
            <span className="mono text-[11.5px] text-ink3">{device.device_id}</span>
            {device.status === 'anomaly' && <Pill tone="bad">Anomaly</Pill>}
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn btn-ghost btn-sm" onClick={onTogglePause}>
              <Icon name={paused ? 'play' : 'pause'} size={13} />
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-icon btn-ghost" onClick={onPrev}>
              <Icon name="chevronLeft" size={13} />
            </button>
            <button className="btn btn-icon btn-ghost" onClick={onNext}>
              <Icon name="chevronRight" size={13} />
            </button>
            <button className="btn btn-icon btn-ghost" onClick={onClose}>
              <Icon name="x" size={13} />
            </button>
          </div>
        </div>
        <div className="relative aspect-video bg-black">
          <CameraFeed device={device} frame={frame} large />
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[11px] text-white/85">
            <span
              className="px-2 h-[22px] rounded-md inline-flex items-center gap-1.5 font-medium"
              style={{ background: paused ? 'var(--warning)' : 'rgba(0,0,0,0.55)', color: paused ? 'var(--ink)' : undefined }}
            >
              {paused ? 'Paused' : frame?.image_url ? 'Snapshot' : 'Offline'}
            </span>
            {frame?.timestamp && (
              <span className="px-2 h-[22px] rounded-md inline-flex items-center gap-1.5 mono tnum" style={{ background: 'rgba(0,0,0,0.45)' }}>
                {fmtTime(frame.timestamp)}
              </span>
            )}
          </div>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-[13px]">
          <Meta label="Operator" value={device.operator_name || '—'} />
          <Meta label="Status" value={device.status || '—'} />
          <Meta label="Engine" value={device.engine_status || '—'} />
          <Meta label="Updated" value={frame?.timestamp ? fmtRelative(frame.timestamp) : '—'} />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink3">{label}</div>
      <div className="mt-0.5 text-ink capitalize">{value}</div>
    </div>
  );
}
