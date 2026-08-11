import React, { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { getAlerts, acknowledgeAlert, acknowledgeAllAlerts } from '../services/api';
import socketService from '../services/socket';
import Icon from '../components/ui/Icon';
import { PageHeader, Stat, FilterChips, Pill, Dot, EmptyState } from '../components/ui';
import { riskTok, severityToRisk, fmtRelative, fmtDateTime } from '../lib/format';
import { useAuth } from '../context/AuthContext';

function notifyAlertsChanged() {
  window.dispatchEvent(new Event('ems:alerts-changed'));
}

export default function Alerts() {
  const { user } = useAuth();
  const canAck = user?.role !== 'viewer';
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [busyIds, setBusyIds] = useState(() => new Set());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await getAlerts('active');
        if (mounted) setAlerts(data);
      } catch (e) {
        if (mounted) setAlerts([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const onNew = (data) => {
      setAlerts((prev) => (prev.some((a) => a.alert_id === data.alert_id) ? prev : [data, ...prev]));
    };
    socketService.connect();
    socketService.on('alert_new', onNew);
    return () => {
      mounted = false;
      socketService.off('alert_new', onNew);
    };
  }, []);

  const setBusy = (id, on) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const dismiss = async (id) => {
    setBusy(id, true);
    try {
      await acknowledgeAlert(id);
      setAlerts((prev) => prev.filter((a) => a.alert_id !== id));
      notifyAlertsChanged();
    } catch (e) {
      // leave in place on failure
    } finally {
      setBusy(id, false);
    }
  };

  const counts = useMemo(() => {
    const byRisk = (r) => alerts.filter((a) => severityToRisk(a.severity) === r).length;
    return { all: alerts.length, high: byRisk('HIGH'), medium: byRisk('MEDIUM'), low: byRisk('LOW') };
  }, [alerts]);

  const filtered = useMemo(() => {
    if (filter === 'all') return alerts;
    return alerts.filter((a) => severityToRisk(a.severity) === filter.toUpperCase());
  }, [alerts, filter]);

  const active = filtered.find((a) => a.alert_id === selectedId) || filtered[0];

  const [ackingAll, setAckingAll] = useState(false);
  const ackAll = async () => {
    if (filtered.length === 0) return;
    // Snapshot which ids we're clearing so we can reconcile after one request.
    const ids = new Set(filtered.map((a) => a.alert_id));
    setAckingAll(true);
    try {
      await acknowledgeAllAlerts({ severity: filter === 'all' ? undefined : filter });
      setAlerts((prev) => prev.filter((a) => !ids.has(a.alert_id)));
      notifyAlertsChanged();
    } catch (e) {
      // leave list intact on failure
    } finally {
      setAckingAll(false);
    }
  };

  if (user?.role === 'driver') {
    return <Navigate to="/shift-start" replace />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        subtitle="AI-detected anomalies from the live telemetry stream."
        right={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="cpu" size={11} />
              Anomaly detection engine
            </span>
            <span className="inline-flex items-center gap-1.5">{counts.all} active</span>
          </>
        }
        actions={
          canAck && (
            <button className="btn btn-primary" onClick={ackAll} disabled={filtered.length === 0 || ackingAll}>
              <Icon name="check" size={13} />
              {ackingAll ? 'Acking…' : 'Ack all'}
            </button>
          )
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="High risk" value={counts.high} tone="bad" sub="Immediate action recommended" />
        <Stat label="Medium risk" value={counts.medium} tone="warn" sub="Investigate within shift" />
        <Stat label="Low risk" value={counts.low} sub="Informational · log & monitor" />
        <Stat label="Active total" value={counts.all} tone="accent" sub="Unacknowledged across fleet" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.05fr] gap-5">
        {/* LIST — hidden on mobile when detail is open */}
        <div className={`card overflow-hidden flex flex-col ${showDetail ? 'hidden xl:flex' : 'flex'}`}>
          <div className="px-4 py-3 border-b border-line">
            <FilterChips
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'high', label: 'High', count: counts.high },
                { value: 'medium', label: 'Medium', count: counts.medium },
                { value: 'low', label: 'Low', count: counts.low },
              ]}
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-line" style={{ maxHeight: 700 }}>
            {loading && <div className="py-16 text-center text-ink3 text-[13px]">Loading alerts…</div>}
            {!loading && filtered.length === 0 && (
              <div className="py-16 text-center text-ink3 text-[13px]">No alerts in this filter — all clear.</div>
            )}
            {filtered.map((a) => (
              <AlertRow
                key={a.alert_id}
                alert={a}
                isActive={active?.alert_id === a.alert_id}
                busy={busyIds.has(a.alert_id)}
                canAck={canAck}
                onClick={() => { setSelectedId(a.alert_id); setShowDetail(true); }}
                onAck={() => dismiss(a.alert_id)}
              />
            ))}
          </div>
        </div>

        {/* DETAIL — full width on mobile when shown, always visible on xl+ */}
        <div className={showDetail ? 'block' : 'hidden xl:block'}>
          {/* Back button — mobile only */}
          <button
            className="xl:hidden mb-3 btn btn-ghost"
            onClick={() => setShowDetail(false)}
          >
            <Icon name="chevronLeft" size={13} />
            Back to list
          </button>
          {active ? (
            <AlertDetail alert={active} busy={busyIds.has(active.alert_id)} canAck={canAck} onAck={() => dismiss(active.alert_id)} />
          ) : (
            <div className="card">
              <EmptyState icon="alert" title="No alert selected" hint="Pick an alert to inspect its details and AI reasoning." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertRow({ alert, isActive, busy, canAck, onClick, onAck }) {
  const risk = severityToRisk(alert.severity);
  const r = riskTok(risk);
  const title = alert.alert_type || alert.alert_message || 'Anomaly detected';
  return (
    <button
      onClick={onClick}
      className={`relative w-full text-left px-5 py-3.5 transition-colors flex items-start gap-3 ${
        isActive ? 'bg-surface2' : 'hover:bg-surface2'
      }`}
    >
      <Dot color={r.color} size={8} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={risk === 'HIGH' ? 'bad' : risk === 'MEDIUM' ? 'warn' : 'info'}>{r.label}</Pill>
          <span className="text-[13px] font-medium">{alert.device_name || alert.device_id}</span>
          <span className="text-[11px] mono text-ink3">{alert.device_id}</span>
        </div>
        <div className="text-[13px] text-ink2 mt-1.5 leading-snug">{title}</div>
        <div className="mt-2 flex items-center gap-3 text-[11.5px] text-ink3 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Icon name="clock" size={11} />
            {fmtRelative(alert.timestamp)}
          </span>
          {alert.anomaly_score != null && (
            <span>
              Anomaly <span className="tnum text-ink2 font-medium">{(1 - Number(alert.anomaly_score)).toFixed(2)}</span>
            </span>
          )}
        </div>
      </div>
      {canAck && (
        <div className="shrink-0 self-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAck();
            }}
            disabled={busy}
            className="btn btn-ghost h-7 text-[12px] px-2.5"
            title="Acknowledge"
          >
            <Icon name="check" size={11} />
            {busy ? '…' : 'Ack'}
          </button>
        </div>
      )}
    </button>
  );
}

function AlertDetail({ alert, busy, canAck, onAck }) {
  const risk = severityToRisk(alert.severity);
  const r = riskTok(risk);
  const title = alert.alert_type || alert.alert_message || 'Anomaly detected';
  const hasScore = alert.anomaly_score != null;
  // The engine scores 1.0 = normal, 0.0 = anomaly. Present the inverted value as
  // an "anomaly likelihood" so a severe anomaly reads as a high number/full bar.
  const anomalyLikelihood = hasScore ? 1 - Number(alert.anomaly_score) : null;

  const timeline = [
    { t: 'T₀', type: 'alert', text: title },
    { t: '+0', type: 'sys', text: hasScore ? `Anomaly likelihood ${anomalyLikelihood.toFixed(2)} from anomaly engine` : 'Flagged by monitoring engine' },
  ];

  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-line">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={risk === 'HIGH' ? 'bad' : risk === 'MEDIUM' ? 'warn' : 'info'}>{r.label} risk</Pill>
              <span className="text-[11.5px] mono text-ink3">{alert.alert_id}</span>
              <Pill tone="warn">Open</Pill>
            </div>
            <h2 className="mt-3 text-[19px] font-semibold tracking-tight leading-snug max-w-xl">{title}</h2>
            <div className="mt-2 text-[12.5px] text-ink3 flex items-center gap-x-2.5 gap-y-1 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="excavator" size={11} />
                {alert.device_name || alert.device_id} <span className="mono text-ink2">{alert.device_id}</span>
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="clock" size={11} />
                {fmtRelative(alert.timestamp)}
              </span>
            </div>
          </div>
          {canAck && (
            <div className="flex flex-col items-end gap-2 shrink-0">
              <button onClick={onAck} disabled={busy} className="btn btn-primary">
                <Icon name="check" size={13} />
                {busy ? 'Acknowledging…' : 'Acknowledge'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-line divide-x divide-line">
        <DetailStat
          label="Anomaly likelihood"
          value={hasScore ? anomalyLikelihood.toFixed(2) : '—'}
          sub={hasScore ? '0 normal → 1 anomaly' : 'Not scored'}
          chart={hasScore ? <ScoreBar value={anomalyLikelihood} color={r.color} /> : null}
        />
        <DetailStat label="Detected" value={fmtRelative(alert.timestamp)} sub={fmtDateTime(alert.timestamp)} />
        <DetailStat label="Device" value={alert.device_id} sub={alert.device_name || '—'} />
        <DetailStat label="Severity" value={r.label} sub={`Reported as "${alert.severity || 'low'}"`} />
      </div>

      <div className="p-5">
        <div className="text-[13px] font-medium mb-3 flex items-center gap-2">
          <Icon name="activity" size={13} className="text-ink3" />
          Event timeline
        </div>
        <div className="relative pl-7 space-y-3 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-line">
          {timeline.map((e, i) => (
            <div key={i} className="relative">
              <span
                className="absolute -left-[19px] top-[5px] w-2.5 h-2.5 rounded-full bg-bg"
                style={{ border: '2px solid ' + (e.type === 'alert' ? r.color : 'var(--info)') }}
              />
              <div className="flex items-baseline gap-3">
                <span className="mono text-[11px] text-ink3 w-12 tnum">{e.t}</span>
                <span className={`text-[13px] ${e.type === 'alert' ? 'text-ink font-medium' : 'text-ink2'}`}>{e.text}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 p-4 rounded-card bg-surface2 border border-line">
          <div className="text-[12px] text-ink3 mb-1.5 flex items-center gap-2">
            <Icon name="cpu" size={12} />
            AI reasoning
          </div>
          <p className="text-[13px] text-ink2 leading-relaxed">
            {alert.alert_message ||
              `Telemetry for ${alert.device_id} deviated from its normal operating signature and was flagged for review.`}
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailStat({ label, value, sub, chart }) {
  return (
    <div className="px-5 py-3.5">
      <div className="text-[12px] text-ink3">{label}</div>
      <div className="text-[20px] font-semibold tnum mt-1 tracking-tight">{value}</div>
      {sub && <div className="text-[11.5px] text-ink3 mt-0.5">{sub}</div>}
      {chart && <div className="mt-2">{chart}</div>}
    </div>
  );
}

function ScoreBar({ value, color }) {
  return (
    <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: Math.max(0, Math.min(1, value)) * 100 + '%', background: color }} />
    </div>
  );
}
