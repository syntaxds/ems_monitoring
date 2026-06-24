import React, { useEffect, useState, useCallback } from 'react';
import { getDevices, getDeviceCameraLatest, mediaUrl, cameraStreamUrl } from '../services/api';
import socketService from '../services/socket';
import Icon from '../components/ui/Icon';
import { PageHeader, Segmented, FilterChips, Pill, Dot, EmptyState, SignalBars } from '../components/ui';
import { fmtTime, fmtRelative } from '../lib/format';

// A device is "stream-type" when its latest frame URL is an absolute http(s)
// URL (a live MJPEG camera). Snapshot-type cameras store a /media path and are
// just a single still image that updates on WebSocket push — cheap, so they
// render immediately. Live streams are NOT auto-started: opening an MJPEG <img>
// holds a connection open (browser → backend → camera) for as long as the page
// is mounted, so we gate them behind an explicit "Start stream" action and tear
// them down when stopped or when the tile/page unmounts.
function isStreamFrame(frame) {
  return !!(frame && frame.image_url && /^https?:\/\//i.test(frame.image_url));
}

// One-shot snapshot <img> src (cache-busted by timestamp).
function snapshotSrc(frame) {
  if (!frame || !frame.image_url) return null;
  return `${mediaUrl(frame.image_url)}?t=${encodeURIComponent(frame.timestamp || '')}`;
}

export default function Cameras() {
  const [devices, setDevices] = useState([]);
  const [frames, setFrames] = useState({}); // device_id -> { image_url, timestamp }
  const [streamingIds, setStreamingIds] = useState(() => new Set()); // device_ids actively streaming
  const [layout, setLayout] = useState('grid');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const startStream = useCallback((id) => {
    setStreamingIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const stopStream = useCallback((id) => {
    setStreamingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const stopAllStreams = useCallback(() => setStreamingIds(new Set()), []);

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await getDevices();
        if (!mounted) return;
        setDevices(data);
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

    socketService.connect();
    socketService.on('camera_frame', onFrame);
    socketService.on('fuel_update', onFuel);
    socketService.on('alert_new', onAlert);
    return () => {
      mounted = false;
      socketService.off('camera_frame', onFrame);
      socketService.off('fuel_update', onFuel);
      socketService.off('alert_new', onAlert);
    };
  }, [loadAll]);

  // A device counts as "available" if it has a frame (a stored snapshot or a
  // configured live stream). Streaming is a separate, user-initiated state.
  const isAvailable = (d) => !!(frames[d.device_id] && frames[d.device_id].image_url);
  const available = devices.filter(isAvailable).length;
  const streamingCount = streamingIds.size;

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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cameras"
        subtitle="Latest frame per device. Live streams start only when you press play — nothing runs in the background."
        right={
          <>
            <span>
              {available} / {devices.length} available
            </span>
            {streamingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-ok">
                <Dot color="var(--danger)" size={6} pulse />
                {streamingCount} streaming
              </span>
            )}
          </>
        }
        actions={
          <>
            {streamingCount > 0 && (
              <button className="btn btn-ghost" onClick={stopAllStreams} title="Stop all live streams">
                <Icon name="square" size={12} />
                Stop all
              </button>
            )}
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
              streaming={streamingIds.has(d.device_id)}
              onStart={() => startStream(d.device_id)}
              onStop={() => stopStream(d.device_id)}
              onOpen={() => setSelected(d)}
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
          onClose={() => setSelected(null)}
          onPrev={() => openRel(-1)}
          onNext={() => openRel(1)}
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

// Idle poster for a live-stream camera: shows a play button and fetches NOTHING
// until the user starts it.
function StreamPoster({ onStart, large }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink3" style={{ background: '#0a0a0a' }}>
      <Icon name="camera" size={large ? 30 : 24} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
        className="btn btn-primary h-8 text-[12px] px-3.5"
      >
        <Icon name="play" size={12} />
        Start stream
      </button>
      <div className="text-[11px] text-ink3">Live feed is off · no data until you start</div>
    </div>
  );
}

// Renders the actual pixels. `streaming` only matters for live-stream cameras;
// snapshot cameras always show their latest still.
function CameraFeed({ device, frame, streaming, onStart, large }) {
  const [imgError, setImgError] = useState(false);
  const stream = isStreamFrame(frame);
  const frameUrl = frame && frame.image_url;

  // Reset the error state whenever the source identity changes (toggled stream,
  // or a fresh snapshot arrived).
  useEffect(() => {
    setImgError(false);
  }, [streaming, stream, frameUrl]);

  if (stream) {
    if (!streaming) return <StreamPoster onStart={onStart} large={large} />;
    if (imgError) return <CameraOffline />;
    return (
      <img
        src={cameraStreamUrl(device.device_id)}
        alt={`${device.device_name} live stream`}
        className="absolute inset-0 w-full h-full object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

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

function CameraTile({ device, frame, streaming, onStart, onStop, onOpen }) {
  const stream = isStreamFrame(frame);
  const hasFrame = !!(frame && frame.image_url);
  const live = stream && streaming;
  const isAnom = device.status === 'anomaly';

  // Top-left status badge reflects the true feed state.
  let badge;
  if (live) badge = { label: 'Live', live: true };
  else if (stream) badge = { label: 'Stream off', live: false };
  else if (hasFrame) badge = { label: 'Snapshot', live: false };
  else badge = { label: 'Offline', live: false };

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
        <CameraFeed device={device} frame={frame} streaming={streaming} onStart={onStart} />

        {/* Top HUD */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between text-[11px]">
          <div className="flex items-center gap-1.5">
            {badge.live ? (
              <span className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-white font-medium" style={{ background: 'rgba(0,0,0,0.55)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-bad pulse" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-white/70 font-medium" style={{ background: 'rgba(0,0,0,0.55)' }}>
                {badge.label}
              </span>
            )}
            {isAnom && (
              <span className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-white font-medium" style={{ background: 'var(--danger)' }}>
                Anomaly
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Stop control is always visible while streaming so it's discoverable. */}
            {live && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStop();
                }}
                className="inline-flex items-center gap-1 px-1.5 h-[20px] rounded-md text-white font-medium hover:bg-black/70"
                style={{ background: 'rgba(0,0,0,0.55)' }}
                title="Stop stream"
              >
                <Icon name="square" size={10} />
                Stop
              </button>
            )}
            {frame?.timestamp && !live && (
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
          {device.signal != null && <SignalBars value={live ? device.signal : 0} />}
          <span className="text-[11px]">{frame?.timestamp ? fmtRelative(frame.timestamp) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

function CameraModal({ device, frame, onClose, onPrev, onNext }) {
  const stream = isStreamFrame(frame);
  // Opening the modal IS the explicit "watch" action, so a live stream auto-starts
  // here and is torn down the moment the modal closes (the <img> unmounts).
  const [streaming, setStreaming] = useState(stream);
  const live = stream && streaming;

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
            {stream && (
              <button
                className="btn btn-ghost h-8 text-[12px] px-2.5"
                onClick={() => setStreaming((s) => !s)}
                title={streaming ? 'Stop stream' : 'Start stream'}
              >
                <Icon name={streaming ? 'square' : 'play'} size={12} />
                {streaming ? 'Stop' : 'Stream'}
              </button>
            )}
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
          <CameraFeed device={device} frame={frame} streaming={streaming} onStart={() => setStreaming(true)} large />
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-[11px] text-white/85">
            {live ? (
              <span className="px-2 h-[22px] rounded-md inline-flex items-center gap-1.5 font-medium" style={{ background: 'rgba(0,0,0,0.55)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-bad pulse" />
                Live
              </span>
            ) : (
              <span className="px-2 h-[22px] rounded-md inline-flex items-center gap-1.5 font-medium" style={{ background: 'rgba(0,0,0,0.55)' }}>
                {stream ? 'Stream off' : frame?.image_url ? 'Snapshot' : 'Offline'}
              </span>
            )}
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
