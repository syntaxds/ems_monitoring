import React, { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { getDevices, generateReport, exportDriverShiftLogs } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/ui/Icon';
import { PageHeader, Stat, SectionTitle, Segmented, SelectInput, Field, TextInput, Pill } from '../components/ui';
import { fmtNum, fmtRelative } from '../lib/format';

const EXPORT_TYPES = [
  { value: 'fleet', label: 'Fleet Telemetry' },
  { value: 'driver_logs', label: 'Driver Shift Logs' },
];

const RECENT_KEY = 'ems_recent_exports';

function triggerDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function dayDiff(a, b) {
  if (!a || !b) return 0;
  return Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000) + 1);
}

export default function ExportData() {
  const { user } = useAuth();
  const exportTypes = EXPORT_TYPES.filter((t) => t.value !== 'driver_logs' || user?.role !== 'driver');
  const [devices, setDevices] = useState([]);
  const [from, setFrom] = useState(todayISO(-1));
  const [to, setTo] = useState(todayISO(0));
  const [statusFilter, setStatusFilter] = useState('all');
  const [exportType, setExportType] = useState('fleet');
  const [fmt, setFmt] = useState('csv');
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState(loadRecent);

  const loadDevices = useCallback(async () => {
    try {
      const { data } = await getDevices();
      setDevices(data);
    } catch (e) {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const rows = devices.filter((d) => (statusFilter === 'all' ? true : d.status === statusFilter));
  const summary = {
    total: devices.length,
    active: devices.filter((d) => d.status === 'active').length,
    idle: devices.filter((d) => d.status === 'idle').length,
    anomaly: devices.filter((d) => d.status === 'anomaly').length,
  };

  const setPreset = (days) => {
    setFrom(todayISO(-days));
    setTo(todayISO(0));
  };

  const doExport = async (format, range, type) => {
    const start = range ? range.from : from;
    const end = range ? range.to : to;
    const useFmt = format || fmt;
    const useType = type || exportType;
    if (!start || !end) {
      setError('Select a start and end date first.');
      return;
    }
    setError('');
    setExporting(useFmt);
    try {
      const isDriverLogs = useType === 'driver_logs';
      const res = isDriverLogs
        ? await exportDriverShiftLogs({ start_date: start, end_date: end, format: useFmt })
        : await generateReport({ start_date: start, end_date: end, format: useFmt });
      const ext = useFmt === 'pdf' ? 'pdf' : 'csv';
      const prefix = isDriverLogs ? 'driver_shift_logs' : 'ems_report';
      const file = `${prefix}_${start}_to_${end}.${ext}`;
      triggerDownload(res.data, file);
      const entry = {
        file,
        format: useFmt.toUpperCase(),
        type: useType,
        typeLabel: isDriverLogs ? 'Driver Shift Logs' : 'Fleet Telemetry',
        range: `${start} → ${end}`,
        when: Date.now(),
        rows: isDriverLogs ? null : rows.length,
      };
      const next = [entry, ...recent].slice(0, 8);
      setRecent(next);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch (e) {
        // ignore quota
      }
    } catch (e) {
      setError('Export failed. Please try again.');
    } finally {
      setExporting('');
    }
  };

  if (user?.role === 'driver') {
    return <Navigate to="/shift-start" replace />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Export"
        subtitle="Pull a fleet telemetry report for a date range for downstream analytics."
        actions={
          <button className="btn btn-primary" onClick={() => doExport()} disabled={exporting !== ''}>
            <Icon name="download" size={13} />
            {exporting ? 'Exporting…' : `Export ${fmt.toUpperCase()}`}
          </button>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-5">
        {/* Filter rail */}
        <aside className="card overflow-hidden self-start">
          <SectionTitle title="Filters" />
          <div className="p-5 space-y-4">
            {exportTypes.length > 1 && (
              <Field label="Report">
                <Segmented value={exportType} onChange={setExportType} options={exportTypes} />
              </Field>
            )}

            <div>
              <div className="text-[12.5px] text-ink2 mb-1.5 font-medium">Date range</div>
              <div className="grid grid-cols-2 gap-2">
                <TextInput type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                <TextInput type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  { label: '24h', days: 1 },
                  { label: '7d', days: 7 },
                  { label: '30d', days: 30 },
                  { label: 'Quarter', days: 90 },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setPreset(p.days)}
                    className="h-7 px-2.5 rounded-full border border-line text-[11.5px] text-ink2 hover:text-ink hover:border-line2 font-medium"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {exportType === 'fleet' && (
              <Field label="Status">
                <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="idle">Idle</option>
                  <option value="anomaly">Anomaly</option>
                </SelectInput>
              </Field>
            )}

            <Field label="Format">
              <Segmented
                value={fmt}
                onChange={setFmt}
                options={[
                  { value: 'csv', label: 'CSV' },
                  { value: 'pdf', label: 'PDF' },
                ]}
              />
            </Field>

            {error && <div className="text-[12.5px] text-bad bg-bad/10 rounded-btn px-3 py-2">{error}</div>}

            <div className="pt-3 border-t border-line space-y-1.5 text-[12px]">
              {exportType === 'fleet' && <Row label="Devices in result" value={fmtNum(rows.length)} />}
              <Row label="Date span" value={`${dayDiff(from, to)} days`} />
              <Row label="Format" value={fmt.toUpperCase()} />
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="space-y-5 min-w-0">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Devices in result" value={fmtNum(rows.length)} unit="devices" sub={`${summary.total} total in fleet`} />
            <Stat label="Date span" value={dayDiff(from, to)} unit="days" sub={`${from} → ${to}`} />
            <Stat label="Anomalies" value={summary.anomaly} tone="bad" sub="In current selection" />
            <Stat
              label="Last export"
              value={recent[0] ? fmtRelative(recent[0].when) : '—'}
              sub={recent[0] ? `${recent[0].format} · ${recent[0].typeLabel || 'Fleet Telemetry'}` : 'None yet'}
            />
          </div>

          <div className="card overflow-hidden">
            <SectionTitle
              title="Preview · device snapshot"
              subtitle={`${Math.min(12, rows.length)} of ${rows.length} rows`}
              right={<Pill tone="ok"><Icon name="check" size={11} />Live data</Pill>}
            />
            <div className="overflow-x-auto">
              <table className="t">
                <thead>
                  <tr>
                    <th>device_id</th>
                    <th>name</th>
                    <th>operator</th>
                    <th>fuel (L)</th>
                    <th>volt</th>
                    <th>status</th>
                    <th>updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 12).map((d) => (
                    <tr key={d.device_id}>
                      <td className="mono text-ink">{d.device_id}</td>
                      <td>{d.device_name}</td>
                      <td className="text-ink2">{d.operator_name || '—'}</td>
                      <td className="mono tnum text-ink">{d.fuel_level != null ? Number(d.fuel_level).toFixed(1) : '—'}</td>
                      <td className="mono tnum text-ink2">{d.voltage != null ? Number(d.voltage).toFixed(2) : '—'}</td>
                      <td>
                        <Pill tone={d.status === 'anomaly' ? 'bad' : d.status === 'active' ? 'ok' : 'neutral'}>{d.status}</Pill>
                      </td>
                      <td className="text-ink3 text-[12.5px]">{fmtRelative(d.last_updated)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-ink3 py-8">
                        No devices match this status filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <SectionTitle title="Recent exports" />
            {recent.length === 0 ? (
              <div className="py-8 text-center text-ink3 text-[13px]">No exports yet — your downloads will appear here.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="t">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Type</th>
                      <th>Format</th>
                      <th>Range</th>
                      <th>When</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <span className="mono text-[12px]">{r.file}</span>
                        </td>
                        <td className="text-[12.5px] text-ink2">{r.typeLabel || 'Fleet Telemetry'}</td>
                        <td className="text-[12.5px] text-ink2">{r.format}</td>
                        <td className="mono text-[12px] text-ink2">{r.range}</td>
                        <td className="text-ink3 text-[12.5px]">{fmtRelative(r.when)}</td>
                        <td className="text-right">
                          <button
                            className="btn btn-ghost h-7 text-[12px] px-2"
                            disabled={exporting !== ''}
                            onClick={() => {
                              const [rf, rt] = r.range.split(' → ');
                              doExport(r.format.toLowerCase(), { from: rf, to: rt }, r.type || 'fleet');
                            }}
                          >
                            <Icon name="download" size={11} />
                            Re-pull
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink3">{label}</span>
      <span className="text-ink font-medium tnum">{value}</span>
    </div>
  );
}
