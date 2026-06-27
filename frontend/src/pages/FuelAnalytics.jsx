import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { getDevices, getDeviceFuel } from '../services/api';
import socketService from '../services/socket';
import Icon from '../components/ui/Icon';
import { PageHeader, Stat, Segmented, SelectInput, SectionTitle, Pill, Dot } from '../components/ui';
import { fmtTime, fmtDateTime } from '../lib/format';

const TANK_CAPACITY_L = 249.75;

const RANGES = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function rangeBounds(key) {
  const end = new Date();
  const start = new Date(end.getTime() - RANGES[key]);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Group readings into hourly buckets; consumption = fuel drop across the hour.
function hourlyConsumption(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const d = new Date(r.timestamp);
    const key = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const result = [];
  for (const [hour, items] of buckets) {
    items.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const drop = Number(items[0].fuel_level) - Number(items[items.length - 1].fuel_level);
    const running = items.some((i) => i.engine_status === 'running');
    result.push({ hour, value: Math.max(0, Number(drop.toFixed(2))), running });
  }
  return result;
}

// Detect step rises (refuels) and sharp drops (anomalies) between readings.
function detectEvents(points) {
  const events = [];
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].v - points[i - 1].v;
    if (delta > 30) events.push({ t: points[i].t, type: 'refuel', amount: delta });
    else if (delta < -30) events.push({ t: points[i].t, type: 'anomaly', amount: delta });
  }
  return events.reverse();
}

export default function FuelAnalytics() {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState('');
  const [range, setRange] = useState('24h');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await getDevices();
        setDevices(data);
        if (data.length > 0) setSelected(data[0].device_id);
      } catch (e) {
        setDevices([]);
      }
    })();
  }, []);

  const fetchFuel = useCallback(async (deviceId, key) => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const { start, end } = rangeBounds(key);
      const { data } = await getDeviceFuel(deviceId, start, end);
      setRows(data);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) fetchFuel(selected, range);
  }, [selected, range, fetchFuel]);

  // Re-fetch when new telemetry arrives for the selected device so chart
  // updates without manual refresh. Debounced 1s to batch rapid messages.
  useEffect(() => {
    if (!selected) return;
    let timer = null;
    const onFuel = (data) => {
      if (data.device_id !== selected) return;
      clearTimeout(timer);
      timer = setTimeout(() => fetchFuel(selected, range), 1000);
    };
    socketService.connect();
    socketService.on('fuel_update', onFuel);
    return () => {
      socketService.off('fuel_update', onFuel);
      clearTimeout(timer);
    };
  }, [selected, range, fetchFuel]);

  const points = useMemo(
    () =>
      [...rows]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map((r) => ({ t: new Date(r.timestamp).getTime(), v: Number(r.fuel_level), engine: r.engine_status })),
    [rows]
  );

  const metrics = useMemo(() => {
    if (points.length === 0) return { current: null, burned: null, burnRate: null, refuels: 0 };
    const current = points[points.length - 1].v;
    // Accumulate genuine per-step drops instead of first→last net change.
    // first→last gives 0 whenever fuel has a net rise (EMA settling, refuel),
    // even if real consumption happened in between.
    let consumed = 0;
    let runningMs = 0;
    let refuels = 0;
    for (let i = 1; i < points.length; i++) {
      const delta = points[i].v - points[i - 1].v;
      if (points[i - 1].engine === 'running') runningMs += points[i].t - points[i - 1].t;
      if (delta < 0) consumed += -delta;
      else if (delta > 30) refuels++;
    }
    const runningHours = runningMs / 3600000;
    const burnRate = runningHours > 0 ? consumed / runningHours : 0;
    return {
      current,
      burned: Number(consumed.toFixed(1)),
      burnRate: Number(burnRate.toFixed(1)),
      refuels,
    };
  }, [points]);

  const hourly = useMemo(() => hourlyConsumption(rows), [rows]);
  const maxHourly = useMemo(() => Math.max(1, ...hourly.map((h) => h.value)), [hourly]);
  const events = useMemo(() => detectEvents(points), [points]);
  const selectedDevice = devices.find((d) => d.device_id === selected);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fuel"
        subtitle="Consumption, refuels, and burn-rate anomalies per device."
        actions={
          <button className="btn btn-ghost" onClick={() => fetchFuel(selected, range)}>
            <Icon name="refresh" size={13} />
            Refresh
          </button>
        }
      />

      {/* Controls */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] text-ink3 shrink-0">Range</span>
          <Segmented
            value={range}
            onChange={setRange}
            size="sm"
            options={[
              { value: '6h', label: '6h' },
              { value: '24h', label: '24h' },
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[12px] text-ink3 shrink-0">Device</span>
          <div className="flex-1 min-w-0">
            <SelectInput value={selected} onChange={(e) => setSelected(e.target.value)}>
              {devices.length === 0 && <option value="">No devices</option>}
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_name} · {d.device_id}
                </option>
              ))}
            </SelectInput>
          </div>
        </div>
        <div className="sm:ml-auto flex items-center gap-2 shrink-0">
          <Pill tone="neutral">
            <Dot color="var(--text-3)" size={6} />
            Snapshot
          </Pill>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Current level"
          value={metrics.current != null ? Math.round(metrics.current) : '—'}
          unit="L"
          sub={metrics.current != null ? `${Math.round((metrics.current / TANK_CAPACITY_L) * 100)}% of ${TANK_CAPACITY_L}L tank` : 'No data'}
        />
        <Stat label="Fuel burned" value={metrics.burned != null ? metrics.burned : '—'} unit="L" tone="accent" sub={`Over the last ${range}`} />
        <Stat label="Burn rate" value={metrics.burnRate != null ? metrics.burnRate : '—'} unit="L / hr" sub="While engine running" />
        <Stat label="Refuel events" value={metrics.refuels} unit={metrics.refuels === 1 ? 'event' : 'events'} tone="ok" sub="Detected by step-rise" />
      </div>

      {/* Chart */}
      <div className="card overflow-hidden">
        <SectionTitle
          title={`Fuel level · ${selectedDevice ? selectedDevice.device_name : '—'}`}
          subtitle="Tank level over the selected range"
          right={
            <div className="flex items-center gap-3 text-[11.5px] text-ink3">
              <LegendDot color="var(--accent)" label="Level" />
              <LegendDot color="var(--danger)" label="Anomaly" />
            </div>
          }
        />
        <div className="p-4">
          {loading ? (
            <div className="h-[320px] flex items-center justify-center text-ink3 text-[13px]">Loading…</div>
          ) : points.length < 2 ? (
            <div className="h-[320px] flex items-center justify-center text-ink3 text-[13px]">
              No fuel data for this range.
            </div>
          ) : (
            <FuelChart points={points} hover={hover} setHover={setHover} />
          )}
        </div>
      </div>

      {/* Two-col */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-5">
        <div className="card overflow-hidden">
          <SectionTitle title={`Hourly consumption · ${range}`} right={<span className="text-[11.5px] text-ink3">Litres burned</span>} />
          <div className="p-4 space-y-2.5">
            {hourly.length === 0 && <div className="py-8 text-center text-ink3 text-[13px]">No data in this range.</div>}
            {hourly.map((h) => (
              <ConsumptionBar key={h.hour} label={h.hour} value={h.value} max={maxHourly} running={h.running} />
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <SectionTitle title="Refuel & anomaly events" right={<Pill tone={events.length ? 'bad' : 'ok'}>{events.length} events</Pill>} />
          <div className="divide-line">
            {events.length === 0 && <div className="py-8 text-center text-ink3 text-[13px]">No notable events.</div>}
            {events.map((ev, i) => (
              <div key={i} className="px-4 py-3.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium flex items-center gap-2">
                    {ev.type === 'refuel' ? 'Refuel logged' : 'Sharp fuel drop'}
                  </div>
                  <div className="text-[12.5px] text-ink2 mt-1">
                    <span className={ev.type === 'refuel' ? 'text-ok font-medium' : 'text-bad font-medium'}>
                      {ev.amount > 0 ? '+' : ''}
                      {ev.amount.toFixed(0)}L
                    </span>
                    <span className="text-ink3"> · {fmtDateTime(ev.t)}</span>
                  </div>
                </div>
                <Pill tone={ev.type === 'refuel' ? 'ok' : 'bad'}>
                  {ev.type === 'refuel' ? <Icon name="check" size={11} /> : <Icon name="alert" size={11} />}
                  {ev.type === 'refuel' ? 'Logged' : 'Anomaly'}
                </Pill>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Dot color={color} size={6} />
      {label}
    </span>
  );
}

function ConsumptionBar({ label, value, max, running }) {
  const pct = (value / max) * 100;
  const color = running ? 'var(--accent)' : 'var(--text-3)';
  return (
    <div className="grid grid-cols-[120px_1fr_60px] items-center gap-3">
      <div className="flex items-center gap-2 text-[12.5px] min-w-0">
        <span className="mono text-[11px] text-ink3 truncate">{label}</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct + '%', background: color }} />
      </div>
      <div className="text-right mono tnum text-[12.5px] font-medium">
        {value.toFixed(0)}
        <span className="text-ink3"> L</span>
      </div>
    </div>
  );
}

// ─────────────────────────── Clean SVG chart (ported from design) ─────────────
function FuelChart({ points, hover, setHover }) {
  const W = 1000;
  const H = 320;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const svgRef = useRef(null);

  const minT = points[0].t;
  const maxT = points[points.length - 1].t;
  const spanT = maxT - minT || 1;
  const dataMax = Math.max(...points.map((p) => p.v));
  const yMax = Math.max(TANK_CAPACITY_L, Math.ceil(dataMax / 100) * 100);
  const yMin = 0;
  const tx = (t) => padL + ((t - minT) / spanT) * innerW;
  const ty = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const smoothLine = (ps) => {
    if (ps.length < 2) return '';
    const xs = ps.map((p) => tx(p.t));
    const ys = ps.map((p) => ty(p.v));
    let d = `M ${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`;
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i];
      const y0 = ys[i];
      const x1 = xs[i + 1];
      const y1 = ys[i + 1];
      const cx = (x0 + x1) / 2;
      d += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    return d;
  };
  const areaD = (ps) =>
    smoothLine(ps) + ` L ${tx(ps[ps.length - 1].t).toFixed(1)},${padT + innerH} L ${tx(ps[0].t).toFixed(1)},${padT + innerH} Z`;

  const anomalies = useMemo(() => {
    const o = [];
    for (let i = 1; i < points.length; i++) if (points[i - 1].v - points[i].v > 30) o.push(points[i]);
    return o;
  }, [points]);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
  const xTickCount = 6;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => minT + (spanT * i) / xTickCount);

  const onMove = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let near = null;
    let best = Infinity;
    for (const p of points) {
      const dx = Math.abs(tx(p.t) - x);
      if (dx < best) {
        best = dx;
        near = p;
      }
    }
    if (near) setHover({ ...near, x: tx(near.t), y: ty(near.v) });
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[320px]"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="ch-area-v2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={ty(v)} y2={ty(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 10} y={ty(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {v}
            </text>
          </g>
        ))}

        {xTicks.map((t, i) => (
          <text key={i} x={tx(t)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">
            {fmtTime(t)}
          </text>
        ))}

        {anomalies.map((p, i) => (
          <circle key={i} cx={tx(p.t)} cy={ty(p.v)} r="4" fill="var(--danger)" stroke="var(--bg)" strokeWidth="2" />
        ))}

        <path d={areaD(points)} fill="url(#ch-area-v2)" />
        <path d={smoothLine(points)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        <circle cx={tx(points[points.length - 1].t)} cy={ty(points[points.length - 1].v)} r="3.5" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />

        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={padT} y2={padT + innerH} stroke="var(--text-3)" strokeOpacity="0.4" strokeDasharray="3 3" />
            <circle cx={hover.x} cy={hover.y} r="4" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover && (() => {
        const flipX = hover.x / W > 0.65;
        const flipY = hover.y / H < 0.35;
        return (
          <div
            className="absolute pointer-events-none card px-3 py-2 text-[12px]"
            style={{
              boxShadow: 'var(--shadow)',
              ...(flipX
                ? { right: `calc(${(1 - hover.x / W) * 100}% + 12px)` }
                : { left: `calc(${(hover.x / W) * 100}% + 12px)` }),
              ...(flipY
                ? { top: `calc(${(hover.y / H) * 100}% + 10px)` }
                : { top: `calc(${(hover.y / H) * 100}% - 14px)`, transform: 'translateY(-100%)' }),
              minWidth: 140,
            }}
          >
            <div className="text-[11px] text-ink3">{fmtDateTime(hover.t)}</div>
            <div className="text-[16px] font-semibold tnum mt-0.5">
              {hover.v.toFixed(1)}
              <span className="text-ink3 text-[11px] font-normal ml-1">L</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
