// Formatting + status-token helpers ported from the design prototype
// (src/mock.jsx + src/v2/ui.jsx), adapted to operate on real timestamps.

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toMs(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isNaN(ts) ? null : ts;
  // Strings without a timezone indicator are UTC in this system — append Z so
  // the browser doesn't misread them as local time (which would shift by +7h).
  const s = ts.trim().replace(' ', 'T');
  const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z';
  const ms = new Date(normalized).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function fmtRelative(ts, now = Date.now()) {
  const ms = toMs(ts);
  if (ms == null) return '—';
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
  const dd = Math.floor(h / 24);
  return dd + 'd ago';
}

export function fmtTime(ts) {
  const ms = toMs(ts);
  if (ms == null) return '—';
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function fmtDateTime(ts) {
  const ms = toMs(ts);
  if (ms == null) return '—';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function fmtNum(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtCoord(n) {
  if (n == null) return '—';
  const v = Number(n);
  return (v >= 0 ? '+' : '') + v.toFixed(4) + '°';
}

// ── status tokens ───────────────────────────────────────────────
export function statusTok(s) {
  if (s === 'anomaly') return { label: 'Anomaly', cls: 'bg-bad/15 text-bad', dot: 'var(--danger)' };
  if (s === 'active') return { label: 'Active', cls: 'bg-ok/12 text-ok', dot: 'var(--success)' };
  return { label: 'Idle', cls: 'bg-surface3 text-ink2', dot: 'var(--text-3)' };
}

export function engineTok(e) {
  if (e === 'running') return { label: 'Running', color: 'var(--success)' };
  if (e === 'idle') return { label: 'Idle', color: 'var(--warning)' };
  return { label: 'Off', color: 'var(--text-3)' };
}

export function riskTok(r) {
  if (r === 'HIGH') return { label: 'High', color: 'var(--danger)', soft: 'bg-bad/15 text-bad' };
  if (r === 'MEDIUM') return { label: 'Medium', color: 'var(--warning)', soft: 'bg-warn/12 text-warn' };
  return { label: 'Low', color: 'var(--info)', soft: 'bg-info/12 text-info' };
}

export function fuelTok(pct) {
  if (pct <= 20) return { color: 'var(--danger)', cls: 'text-bad' };
  if (pct <= 40) return { color: 'var(--warning)', cls: 'text-warn' };
  return { color: 'var(--success)', cls: 'text-ok' };
}

// Map a free-form severity string from the API onto the design's risk levels.
export function severityToRisk(severity) {
  const s = String(severity || '').toLowerCase();
  if (s === 'high' || s === 'critical') return 'HIGH';
  if (s === 'medium' || s === 'warning' || s === 'warn') return 'MEDIUM';
  return 'LOW';
}
