import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { getDevices, getDeviceFuel } from '../services/api';
import FuelChart from '../components/FuelChart';

const RANGES = {
  '1H': 1 * 60 * 60 * 1000,
  '24H': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000
};

function rangeBounds(key) {
  const end = new Date();
  const start = new Date(end.getTime() - RANGES[key]);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Group readings into hourly buckets and compute consumption (fuel drop) per
// hour, flagging hours with no running engine reading as idle.
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
    result.push({ hour, consumption: Math.max(0, Number(drop.toFixed(2))), running });
  }
  return result;
}

export default function FuelAnalytics() {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState('');
  const [rangeKey, setRangeKey] = useState('24H');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load device list once; default to the first device.
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
    if (selected) fetchFuel(selected, rangeKey);
  }, [selected, rangeKey, fetchFuel]);

  const metrics = useMemo(() => {
    if (rows.length === 0) {
      return { current: null, total: null, avgFlow: null, peak: null };
    }
    const sorted = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const current = Number(sorted[sorted.length - 1].fuel_level);
    const total = Number(sorted[0].fuel_level) - current;

    // Running hours: count distinct readings flagged running, scaled by the
    // 5-minute reporting interval.
    const runningSamples = sorted.filter((r) => r.engine_status === 'running').length;
    const runningHours = (runningSamples * 5) / 60; // 5-min cadence
    const avgFlow = runningHours > 0 ? total / runningHours : 0;

    // Peak flow: largest single drop between consecutive readings.
    let peak = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const drop = Number(sorted[i - 1].fuel_level) - Number(sorted[i].fuel_level);
      if (drop > peak) peak = drop;
    }

    return {
      current,
      total: Number(total.toFixed(1)),
      avgFlow: Number(avgFlow.toFixed(2)),
      peak: Number(peak.toFixed(1))
    };
  }, [rows]);

  const lineData = useMemo(
    () =>
      [...rows]
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map((r) => ({
          time: new Date(r.timestamp).toLocaleString([], {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          fuel_level: Number(r.fuel_level)
        })),
    [rows]
  );

  const barData = useMemo(() => hourlyConsumption(rows), [rows]);

  const hasData = rows.length > 0;

  return (
    <div className="page">
      <h1 className="page-title">Fuel Analytics</h1>

      <div className="controls-row">
        <select
          className="select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {devices.length === 0 && <option value="">No devices</option>}
          {devices.map((d) => (
            <option key={d.device_id} value={d.device_id}>
              {d.device_name} ({d.device_id})
            </option>
          ))}
        </select>

        <div className="range-btns">
          {Object.keys(RANGES).map((key) => (
            <button
              key={key}
              className={`btn ${rangeKey === key ? 'active' : ''}`}
              onClick={() => setRangeKey(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="metric-grid">
        <div className="summary-card">
          <div className="label">Current Level</div>
          <div className="value">{metrics.current != null ? `${metrics.current.toFixed(1)} L` : '—'}</div>
        </div>
        <div className="summary-card">
          <div className="label">Total Consumption</div>
          <div className="value">{metrics.total != null ? `${metrics.total} L` : '—'}</div>
        </div>
        <div className="summary-card">
          <div className="label">Avg Fuel Flow</div>
          <div className="value">{metrics.avgFlow != null ? `${metrics.avgFlow} L/h` : '—'}</div>
        </div>
        <div className="summary-card">
          <div className="label">Peak Flow</div>
          <div className="value">{metrics.peak != null ? `${metrics.peak} L` : '—'}</div>
        </div>
      </div>

      <div className="chart-panel">
        <h3>Fuel Level Over Time</h3>
        {loading ? (
          <div className="spinner">Loading…</div>
        ) : (
          <FuelChart data={lineData} />
        )}
      </div>

      <div className="chart-panel">
        <h3>Hourly Consumption Rate</h3>
        {!hasData ? (
          <div className="empty-state">No data available for selected range</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#333" strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke="#9a9a9a" tick={{ fontSize: 11 }} minTickGap={16} />
              <YAxis stroke="#9a9a9a" tick={{ fontSize: 12 }} unit=" L" width={60} />
              <Tooltip
                contentStyle={{ background: '#232323', border: '1px solid #383838', color: '#e8e8e8' }}
                labelStyle={{ color: '#9a9a9a' }}
              />
              <Bar dataKey="consumption" name="Consumption (L)">
                {barData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.running ? '#f97316' : '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
