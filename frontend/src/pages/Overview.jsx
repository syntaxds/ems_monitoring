import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { getDevices } from '../services/api';
import socketService from '../services/socket';
import MapView from '../components/MapView';
import Icon from '../components/ui/Icon';
import {
  PageHeader,
  Stat,
  SectionTitle,
  Pill,
  Dot,
  FilterChips,
  TextInput,
  FuelBar,
} from '../components/ui';
import { fuelTok, engineTok, fmtRelative } from '../lib/format';

const TANK_CAPACITY_L = 249.75;

export default function Overview() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [focusId, setFocus] = useState(null);

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

    const applyUpdate = (deviceId, patch) => {
      setDevices((prev) => prev.map((d) => (d.device_id === deviceId ? { ...d, ...patch } : d)));
    };
    const onFuel = (data) =>
      applyUpdate(data.device_id, {
        fuel_level: data.fuel_level,
        engine_status: data.engine_status,
        voltage: data.voltage,
        status: 'active',
        last_updated: data.timestamp,
      });
    const onGps = (data) =>
      applyUpdate(data.device_id, {
        latitude: data.latitude,
        longitude: data.longitude,
        last_updated: data.timestamp,
      });
    const onAlert = (data) => applyUpdate(data.device_id, { status: 'anomaly' });

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
  const anomaly = devices.filter((d) => d.status === 'anomaly').length;
  const running = devices.filter((d) => d.engine_status === 'running').length;
  const off = devices.filter((d) => d.engine_status === 'off').length;

  const located = useMemo(() => devices.filter((d) => d.latitude != null && d.longitude != null), [devices]);
  const centroid = useMemo(() => {
    if (located.length === 0) return null;
    const lat = located.reduce((s, d) => s + Number(d.latitude), 0) / located.length;
    const lon = located.reduce((s, d) => s + Number(d.longitude), 0) / located.length;
    return { lat, lon };
  }, [located]);

  const filtered = devices.filter((d) => {
    if (filter !== 'all' && d.status !== filter) return false;
    if (query) {
      const q = query.toLowerCase();
      if (
        !String(d.device_id || '').toLowerCase().includes(q) &&
        !String(d.device_name || '').toLowerCase().includes(q) &&
        !String(d.operator_name || '').toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        subtitle="Live fleet status across all registered excavators · telemetry streamed in real time."
        actions={
          <>
            <button className="btn btn-ghost" onClick={load}>
              <Icon name="refresh" size={13} />
              Refresh
            </button>
          </>
        }
      />

      {error && (
        <div className="card card-pad text-[13px] text-bad bg-bad/10">{error}</div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Fleet total" value={total} unit="excavators" sub={`${running} running · ${off} off`} />
        <Stat label="Active now" value={active} tone="ok" sub={`${idle} idle right now`} />
        <Stat label="Idle" value={idle} tone="warn" sub="Reporting but not productive" />
        <Stat label="Anomalies" value={anomaly} tone="bad" sub={anomaly === 1 ? '1 device flagged' : `${anomaly} devices flagged`} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5">
        {/* Map card — keeps the existing Leaflet map */}
        <div className="card overflow-hidden flex flex-col">
          <SectionTitle
            title="Live fleet map"
            subtitle={`${located.length} of ${total} devices located`}
            right={
              <>
                {centroid && (
                  <Pill tone="neutral">
                    <Icon name="pin" size={11} />
                    {centroid.lat.toFixed(3)}°, {centroid.lon.toFixed(3)}°
                  </Pill>
                )}
              </>
            }
          />
          <div className="h-48 sm:h-64 lg:h-[540px]">
            <MapView devices={devices} focusId={focusId} onMarkerClick={setFocus} />
          </div>
        </div>

        {/* Device list */}
        <div className="card overflow-hidden flex flex-col">
          <SectionTitle title="Devices" subtitle={`${filtered.length} of ${total} shown`} />
          <div className="px-4 py-3 border-b border-line space-y-2.5">
            <TextInput
              icon="search"
              placeholder="Search ID, name, operator…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <FilterChips
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: total },
                { value: 'active', label: 'Active', count: active },
                { value: 'idle', label: 'Idle', count: idle },
                { value: 'anomaly', label: 'Anomaly', count: anomaly },
              ]}
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-line" style={{ maxHeight: 460 }}>
            {loading && <div className="py-12 text-center text-ink3 text-[13px]">Loading devices…</div>}
            {!loading && filtered.length === 0 && (
              <div className="py-12 text-center text-ink3 text-[13px]">
                {total === 0 ? 'No devices registered yet.' : 'No devices match these filters.'}
              </div>
            )}
            {filtered.map((d) => (
              <DeviceRow
                key={d.device_id}
                d={d}
                focus={focusId === d.device_id}
                onClick={() => setFocus(d.device_id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const DeviceRow = React.memo(function DeviceRow({ d, focus, onClick }) {
  const fuel = d.fuel_level != null ? Number(d.fuel_level) : null;
  const pct = fuel != null ? (fuel / TANK_CAPACITY_L) * 100 : 0;
  const ftk = fuelTok(pct);
  const etk = engineTok(d.engine_status);
  const isAnom = d.status === 'anomaly';
  const gpsFix = d.latitude != null && d.longitude != null;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 transition-colors hover:bg-surface2"
      style={{ background: focus ? 'var(--surface-2)' : 'transparent' }}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-btn bg-surface2 border border-line flex items-center justify-center shrink-0 text-ink2">
          <Icon name="excavator" size={14} strokeWidth={1.7} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium truncate">{d.device_name}</span>
            <span className="text-[11px] text-ink3 mono">{d.device_id}</span>
            {isAnom && <Dot color="var(--danger)" size={6} pulse />}
          </div>
          <div className="text-[11.5px] text-ink3 truncate mt-0.5">
            {d.operator_name || 'Unassigned'}
            {d.site ? ` · ${d.site}` : ''}
          </div>
        </div>

        <Pill tone={d.engine_status === 'running' ? 'ok' : d.engine_status === 'idle' ? 'warn' : 'neutral'}>
          <Dot color={etk.color} size={5} />
          {etk.label}
        </Pill>
      </div>

      <div className="mt-2.5 grid grid-cols-[1fr_auto] items-center gap-3">
        <div>
          <div className="flex items-center justify-between text-[11.5px] mb-1">
            <span className="text-ink3">Fuel</span>
            <span className={`tnum font-medium ${ftk.cls}`}>
              {fuel != null ? Math.round(fuel) : '—'}
              <span className="text-ink3 font-normal"> / {TANK_CAPACITY_L} L</span>
            </span>
          </div>
          <FuelBar level={fuel || 0} capacity={TANK_CAPACITY_L} />
        </div>
        <div className="text-right pl-2">
          <div className="text-[11px] text-ink3">Voltage</div>
          <div className="mono tnum text-[12.5px] font-medium mt-0.5">
            {d.voltage != null ? Number(d.voltage).toFixed(2) : '—'}
            <span className="text-ink3"> V</span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-ink3">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="clock" size={11} />
          {fmtRelative(d.last_updated)}
        </span>
        <span className="inline-flex items-center gap-2">
          {gpsFix && <Icon name="pin" size={11} />}
        </span>
      </div>
    </button>
  );
}, (prev, next) =>
  prev.focus === next.focus &&
  prev.d.fuel_level === next.d.fuel_level &&
  prev.d.engine_status === next.d.engine_status &&
  prev.d.voltage === next.d.voltage &&
  prev.d.latitude === next.d.latitude &&
  prev.d.longitude === next.d.longitude &&
  prev.d.status === next.d.status &&
  prev.d.last_updated === next.d.last_updated
);
