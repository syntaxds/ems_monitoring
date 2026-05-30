// Clean UI primitives — Linear/Vercel-inspired. Ported from the design
// prototype (src/v2/ui.jsx) to ES modules. Sentence case, subtle borders,
// rounded cards, no chrome.
import React from 'react';
import Icon from './Icon';
import { engineTok, fuelTok } from '../../lib/format';
import logo from '../../assets/logo.png';

export { Icon };

// ── Dot ──────────────────────────────────────────────────────────
export function Dot({ color = 'var(--text-3)', size = 6, pulse = false }) {
  return (
    <span
      className={`relative inline-block rounded-full ${pulse ? 'pulse' : ''}`}
      style={{ width: size, height: size, background: color }}
    />
  );
}

// ── Pill / Badge ─────────────────────────────────────────────────
export function Pill({ tone = 'neutral', children, className = '' }) {
  const palette =
    {
      neutral: 'bg-surface2 text-ink2 border-line',
      ok: 'bg-ok/12 text-ok border-transparent',
      bad: 'bg-bad/15 text-bad border-transparent',
      warn: 'bg-warn/12 text-warn border-transparent',
      info: 'bg-info/12 text-info border-transparent',
      accent: 'bg-accent/15 text-accent border-transparent',
    }[tone] || 'bg-surface2 text-ink2 border-line';
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full border text-[11.5px] font-medium ${palette} ${className}`}
    >
      {children}
    </span>
  );
}

// ── Stat — clean KPI card ────────────────────────────────────────
export function Stat({ label, value, unit, sub, trend, tone, sparkline }) {
  const toneCls = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', accent: 'text-accent' }[tone] || 'text-ink';
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-ink2">{label}</span>
        {trend && (
          <span
            className={`inline-flex items-center gap-1 text-[11.5px] tnum ${
              trend.dir === 'down' ? 'text-bad' : trend.dir === 'up' ? 'text-ok' : 'text-ink3'
            }`}
          >
            <Icon name={trend.dir === 'down' ? 'trendDown' : 'trend'} size={12} />
            {trend.value}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-[30px] leading-none font-semibold tnum tracking-tight ${toneCls}`}>{value}</span>
        {unit && <span className="text-[12px] text-ink3 font-medium">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[12px] text-ink3">{sub}</div>}
      {sparkline && (
        <div className="mt-3 h-7">
          <Sparkline data={sparkline.data} color={sparkline.color || 'var(--accent)'} />
        </div>
      )}
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────────────
export function Sparkline({ data, color = 'var(--accent)', width = 220, height = 30 }) {
  if (!data || data.length < 2) return null;
  const values = data.map((d) => (typeof d === 'number' ? d : d.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - ((v - min) / span) * (height - 2) - 1]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const fill = d + ` L ${width},${height} L 0,${height} Z`;
  const gid = 'sp-' + Math.random().toString(36).slice(2, 8);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── FuelBar — slim, single-track ─────────────────────────────────
export function FuelBar({ level, capacity = 600, height = 6 }) {
  const pct = Math.max(0, Math.min(100, (level / capacity) * 100));
  const tok = fuelTok(pct);
  return (
    <div className="relative w-full rounded-full overflow-hidden" style={{ height, background: 'var(--surface-3)' }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct + '%', background: tok.color }} />
    </div>
  );
}

// ── SignalBars ───────────────────────────────────────────────────
export function SignalBars({ value = 0, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="inline-block">
      {[3, 6, 9, 12].map((h, i) => (
        <rect
          key={i}
          x={i * 3 + 0.5}
          y={14 - h}
          width="2"
          height={h}
          rx="0.6"
          fill={i < value ? 'var(--text-2)' : 'var(--surface-3)'}
        />
      ))}
    </svg>
  );
}

// ── PageHeader — clean, sentence case ────────────────────────────
export function PageHeader({ title, subtitle, actions, right }) {
  return (
    <div className="flex items-start justify-between gap-6 mb-6 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink2 max-w-2xl">{subtitle}</p>}
        {right && (
          <div className="mt-2.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[12px] text-ink3">{right}</div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}

// ── Segmented — soft toggle ──────────────────────────────────────
export function Segmented({ options, value, onChange, size = 'md' }) {
  const padCls = size === 'sm' ? 'px-2.5 h-7 text-[12px]' : 'px-3 h-8 text-[12.5px]';
  return (
    <div className="inline-flex p-0.5 rounded-btn bg-surface2 border border-line">
      {options.map((opt) => {
        const v = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const isActive = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`${padCls} rounded-[5px] font-medium transition-colors ${
              isActive ? 'bg-surface text-ink shadow-sm' : 'text-ink2 hover:text-ink'
            }`}
            style={isActive ? { boxShadow: 'var(--shadow-sm)' } : {}}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── FilterChips — outlined chip row ──────────────────────────────
export function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {options.map((o) => {
        const isActive = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`h-7 px-2.5 rounded-full border text-[12px] font-medium transition-colors inline-flex items-center gap-1.5
              ${
                isActive
                  ? 'bg-ink text-bg border-ink'
                  : 'bg-transparent text-ink2 border-line hover:text-ink hover:border-line2'
              }`}
          >
            {o.label}
            {typeof o.count === 'number' && (
              <span className={`tnum text-[11px] ${isActive ? 'opacity-70' : 'text-ink3'}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Field + inputs ───────────────────────────────────────────────
export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <div className="text-[12.5px] text-ink2 mb-1.5 font-medium">{label}</div>
      {children}
      {hint && <div className="text-[11.5px] text-ink3 mt-1.5">{hint}</div>}
    </label>
  );
}

export function TextInput({ icon, className = '', ...props }) {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3">
          <Icon name={icon} size={14} />
        </span>
      )}
      <input {...props} className={`input focus-ring ${icon ? 'pl-9' : ''} ${className}`} />
    </div>
  );
}

export function SelectInput({ children, className = '', ...props }) {
  return (
    <div className="relative">
      <select {...props} className={`input appearance-none pr-9 focus-ring ${className}`}>
        {children}
      </select>
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none">
        <Icon name="chevronDown" size={14} />
      </span>
    </div>
  );
}

// ── SectionTitle — for inside-card section heads ─────────────────
export function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold tracking-tight">{title}</div>
        {subtitle && <div className="text-[12px] text-ink3 mt-0.5">{subtitle}</div>}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

// ── EmptyState ───────────────────────────────────────────────────
export function EmptyState({ icon = 'cube', title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-ink3 mb-3 border border-line">
        <Icon name={icon} size={18} />
      </div>
      <div className="text-[14px] font-medium">{title}</div>
      {hint && <div className="text-ink3 text-[12.5px] mt-1 max-w-sm">{hint}</div>}
    </div>
  );
}

// ── BrandMark — bare PMJ logo, no container ──────────────────────
export function BrandMark({ size = 32 }) {
  return (
    <img
      src={logo}
      alt="Padas Mustapa Jaya"
      className="shrink-0 block"
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}

export { engineTok };
