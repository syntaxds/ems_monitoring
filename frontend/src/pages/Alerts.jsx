import React, { useEffect, useState, useMemo } from 'react';
import { getAlerts, acknowledgeAlert } from '../services/api';
import socketService from '../services/socket';
import AlertCard from '../components/AlertCard';

const FILTERS = ['All', 'High', 'Medium', 'Low'];

function notifyAlertsChanged() {
  window.dispatchEvent(new Event('ems:alerts-changed'));
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
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
      setAlerts((prev) => {
        if (prev.some((a) => a.alert_id === data.alert_id)) return prev;
        return [data, ...prev];
      });
    };

    socketService.connect();
    socketService.on('alert_new', onNew);

    return () => {
      mounted = false;
      socketService.off('alert_new', onNew);
    };
  }, []);

  const setBusy = (id, on) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const dismiss = async (id) => {
    setBusy(id, true);
    try {
      await acknowledgeAlert(id);
      setAlerts((prev) => prev.filter((a) => a.alert_id !== id));
      notifyAlertsChanged();
    } catch (e) {
      // leave the alert in place on failure
    } finally {
      setBusy(id, false);
    }
  };

  const clearAllDisplayed = async () => {
    // Acknowledge each visible alert sequentially.
    for (const a of visible) {
      // eslint-disable-next-line no-await-in-loop
      await dismiss(a.alert_id);
    }
  };

  const visible = useMemo(() => {
    if (filter === 'All') return alerts;
    return alerts.filter((a) => (a.severity || '').toLowerCase() === filter.toLowerCase());
  }, [alerts, filter]);

  return (
    <div className="page">
      <h1 className="page-title">
        Active Alerts {alerts.length > 0 && <span className="nav-badge">{alerts.length}</span>}
      </h1>

      <div className="controls-row" style={{ justifyContent: 'space-between' }}>
        <div className="range-btns">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          className="btn"
          onClick={clearAllDisplayed}
          disabled={visible.length === 0}
        >
          Clear All Displayed Alerts
        </button>
      </div>

      {loading && <div className="spinner">Loading alerts…</div>}
      {!loading && visible.length === 0 && (
        <div className="empty-state">No active alerts.</div>
      )}

      {visible.map((a) => (
        <AlertCard
          key={a.alert_id}
          alert={a}
          onDismiss={dismiss}
          dismissing={busyIds.has(a.alert_id)}
        />
      ))}
    </div>
  );
}
