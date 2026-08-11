import React, { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDriverShiftLogs, mediaUrl } from '../services/api';
import { PageHeader, EmptyState, Pill } from '../components/ui';
import { fmtNum } from '../lib/format';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtClock(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function DriverLogs() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await getDriverShiftLogs();
      setLogs(data);
    } catch (e) {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (user?.role === 'driver') {
    return <Navigate to="/overview" replace />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Driver Logs"
        subtitle="Shift records submitted by drivers — unit, readings, and photo proof for both start and end."
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-ink3 text-[12px]">
                <th className="px-5 py-3 font-medium">Driver</th>
                <th className="px-5 py-3 font-medium">Unit</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Start → End</th>
                <th className="px-5 py-3 font-medium">Fuel (initial → final)</th>
                <th className="px-5 py-3 font-medium">HM (initial → final)</th>
                <th className="px-5 py-3 font-medium">Photos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center text-ink3">Loading shift logs…</td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-0 py-0">
                    <EmptyState icon="excavator" title="No shift logs yet" hint="Driver check-ins will appear here." />
                  </td>
                </tr>
              )}
              {logs.map((l) => (
                <tr key={l.log_id} className="hover:bg-surface2 transition-colors">
                  <td className="px-5 py-3 font-medium">{l.driver_name}</td>
                  <td className="px-5 py-3 text-ink2">{l.device_name} <span className="text-ink3">({l.device_id})</span></td>
                  <td className="px-5 py-3">
                    <Pill tone={l.status === 'active' ? 'ok' : 'neutral'}>{l.status === 'active' ? 'On shift' : 'Completed'}</Pill>
                  </td>
                  <td className="px-5 py-3 mono tnum text-ink2">{fmtDate(l.shift_date)}</td>
                  <td className="px-5 py-3 mono tnum text-ink2">
                    {fmtClock(l.start_time)} → {l.end_time ? fmtClock(l.end_time) : '—'}
                  </td>
                  <td className="px-5 py-3 mono tnum text-ink">
                    {fmtNum(l.fuel_initial, 1)} L → {l.fuel_final != null ? `${fmtNum(l.fuel_final, 1)} L` : '—'}
                  </td>
                  <td className="px-5 py-3 mono tnum text-ink">
                    {fmtNum(l.hour_meter, 1)} → {l.hour_meter_final != null ? fmtNum(l.hour_meter_final, 1) : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPreview({ url: l.photo_url, label: `${l.driver_name} · ${l.device_id} · Start` })}
                        className="block"
                        title="Start photo"
                      >
                        <img
                          src={mediaUrl(l.photo_url)}
                          alt="Shift start proof"
                          className="w-12 h-12 rounded-btn object-cover border border-line hover:opacity-80 transition-opacity"
                        />
                      </button>
                      {l.end_photo_url ? (
                        <button
                          onClick={() => setPreview({ url: l.end_photo_url, label: `${l.driver_name} · ${l.device_id} · End` })}
                          className="block"
                          title="End photo"
                        >
                          <img
                            src={mediaUrl(l.end_photo_url)}
                            alt="Shift end proof"
                            className="w-12 h-12 rounded-btn object-cover border border-line hover:opacity-80 transition-opacity"
                          />
                        </button>
                      ) : (
                        <div className="w-12 h-12 rounded-btn border border-dashed border-line flex items-center justify-center text-ink3 text-[10px]">
                          —
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <img
            src={mediaUrl(preview.url)}
            alt="Shift proof"
            className="max-w-full max-h-[85vh] rounded-card border border-line"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-[12.5px] text-white/80">{preview.label}</span>
        </div>
      )}
    </div>
  );
}
