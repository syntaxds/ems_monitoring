import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import socketService from '../services/socket';
import { getAlerts } from '../services/api';
import Icon from './ui/Icon';
import { Dot, BrandMark } from './ui';
import { fmtTime } from '../lib/format';

const SCREENS = [
  { to: '/overview', label: 'Overview', icon: 'grid' },
  { to: '/fuel', label: 'Fuel', icon: 'fuel' },
  { to: '/alerts', label: 'Alerts', icon: 'alert' },
  { to: '/cameras', label: 'Cameras', icon: 'camera' },
  { to: '/export', label: 'Export', icon: 'download' },
];

// ─────────────────────────── Sidebar ─────────────────────────────
function Sidebar({ user, onLogout, openAlerts }) {
  const name = user?.username || 'User';
  return (
    <aside className="sticky top-0 h-screen shrink-0 flex flex-col border-r border-line bg-bg w-[224px]">
      {/* Brand — logo with product name beneath */}
      <div className="px-4 py-3 flex flex-col items-start gap-1.5 border-b border-line">
        <BrandMark size={38} />
        <div className="text-[11.5px] font-medium tracking-tight text-ink leading-none">PMJ Fleet Management</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2.5 px-2">
        {SCREENS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={({ isActive }) =>
              `group relative w-full flex items-center gap-2.5 px-2.5 h-9 mt-0.5 rounded-btn transition-colors ${
                isActive ? 'bg-surface2 text-ink' : 'text-ink2 hover:text-ink hover:bg-surface2'
              }`
            }
          >
            <Icon name={s.icon} size={15} strokeWidth={1.7} />
            <span className="text-[13px] font-medium flex-1 text-left">{s.label}</span>
            {s.to === '/alerts' && openAlerts > 0 && (
              <span
                className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-[10.5px] font-semibold tnum"
                style={{ color: 'var(--accent-ink)' }}
              >
                {openAlerts}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-2 py-2 border-t border-line">
        <div className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-btn hover:bg-surface2 transition-colors">
          <span className="w-7 h-7 rounded-full bg-surface3 flex items-center justify-center text-[11px] font-semibold">
            {name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-[12.5px] font-medium truncate">{name}</div>
            <div className="text-[11px] text-ink3 truncate">{user?.role || 'Operator'}</div>
          </div>
          <button onClick={onLogout} className="text-ink3 hover:text-ink p-1" title="Sign out">
            <Icon name="logout" size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────── TopBar ─────────────────────────────
function TopBar({ label, connected, clock, openAlerts }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-md border-b border-line">
      <div className="h-[56px] flex items-center gap-3 px-5 lg:px-7">
        <div className="text-[13.5px] font-medium truncate">{label}</div>

        <div className="flex-1" />

        <div className="hidden sm:flex items-center gap-2 px-2.5 h-[26px] rounded-full bg-surface2 border border-line text-[11.5px] text-ink2">
          <Dot color={connected ? 'var(--success)' : 'var(--warning)'} pulse={connected} />
          <span>{connected ? 'Live' : 'Reconnecting'}</span>
          <span className="text-ink3 mono tnum">{fmtTime(clock)}</span>
        </div>

        <button onClick={toggleTheme} className="btn btn-icon btn-ghost" title="Toggle theme">
          <Icon name={theme === 'dark' ? 'eye' : 'eyeOff'} size={14} />
        </button>

        <NavLink to="/alerts" className="btn btn-icon btn-ghost relative" title="Notifications">
          <Icon name="bell" size={14} />
          {openAlerts > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-bad" />}
        </NavLink>
      </div>
    </header>
  );
}

// ─────────────────────────── Shell ──────────────────────────────
export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [connected, setConnected] = useState(false);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [clock, setClock] = useState(Date.now());

  // Live clock.
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // WebSocket connection status.
  useEffect(() => {
    socketService.connect();
    const unsubscribe = socketService.onStatusChange(setConnected);
    return unsubscribe;
  }, []);

  // Unacknowledged alert count — initial fetch + live updates.
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const { data } = await getAlerts('active');
        if (mounted) setOpenAlerts(data.length);
      } catch (e) {
        // leave count as-is
      }
    };
    refresh();

    const onNew = () => setOpenAlerts((c) => c + 1);
    const onChanged = () => refresh();
    socketService.on('alert_new', onNew);
    window.addEventListener('ems:alerts-changed', onChanged);
    return () => {
      mounted = false;
      socketService.off('alert_new', onNew);
      window.removeEventListener('ems:alerts-changed', onChanged);
    };
  }, []);

  const handleLogout = () => {
    socketService.disconnect();
    logout();
    navigate('/login', { replace: true });
  };

  const current = SCREENS.find((s) => location.pathname.startsWith(s.to));
  const label = current ? current.label : 'Overview';

  return (
    <div className="min-h-screen flex">
      <Sidebar user={user} onLogout={handleLogout} openAlerts={openAlerts} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar label={label} connected={connected} clock={clock} openAlerts={openAlerts} />
        <main
          className="flex-1 w-full mx-auto"
          style={{
            maxWidth: 1600,
            paddingLeft: 'var(--pad-page)',
            paddingRight: 'var(--pad-page)',
            paddingTop: 'calc(var(--pad-page) * 0.9)',
            paddingBottom: 'calc(var(--pad-page) * 1.1)',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
