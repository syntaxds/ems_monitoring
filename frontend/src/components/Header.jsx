import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import socketService from '../services/socket';
import { getAlerts } from '../services/api';

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [connected, setConnected] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    socketService.connect();
    const unsubscribe = socketService.onStatusChange(setConnected);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const refreshCount = async () => {
      try {
        const { data } = await getAlerts('active');
        if (mounted) setAlertCount(data.length);
      } catch (e) {
        // ignore — dot/badge simply stays as-is
      }
    };

    refreshCount();

    const onNew = () => setAlertCount((c) => c + 1);
    const onChanged = () => refreshCount();

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

  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="header-brand">PMJ FLEET DASHBOARD</span>
        <nav className="header-nav">
          <NavLink to="/overview" className={({ isActive }) => (isActive ? 'active' : '')}>
            Overview
          </NavLink>
          <NavLink to="/fuel" className={({ isActive }) => (isActive ? 'active' : '')}>
            Fuel Analytics
          </NavLink>
          <NavLink to="/cameras" className={({ isActive }) => (isActive ? 'active' : '')}>
            Cameras
          </NavLink>
          <NavLink to="/alerts" className={({ isActive }) => (isActive ? 'active' : '')}>
            Alerts
            {alertCount > 0 && <span className="nav-badge">{alertCount}</span>}
          </NavLink>
          <NavLink to="/export" className={({ isActive }) => (isActive ? 'active' : '')}>
            Export Data
          </NavLink>
        </nav>
      </div>

      <div className="header-right">
        <span className="ws-status">
          <span className={`dot ${connected ? 'green' : 'red'}`} />
          {connected ? 'Live' : 'Disconnected'}
        </span>
        <span style={{ fontSize: 14 }}>{user ? user.username : ''}</span>
        <button className="btn" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
