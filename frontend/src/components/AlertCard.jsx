import React from 'react';

export default function AlertCard({ alert, onDismiss, dismissing }) {
  const sev = (alert.severity || 'low').toLowerCase();

  return (
    <div className={`alert-card sev-${sev}`}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className={`sev-pill sev-${sev}`}>{sev}</span>
          <strong>{alert.alert_type}</strong>
        </div>
        <div style={{ marginTop: 6, fontSize: 14 }}>{alert.alert_message}</div>
        <div className="alert-meta">
          {(alert.device_name || alert.device_id)} · {alert.device_id}
          {alert.timestamp ? ` · ${new Date(alert.timestamp).toLocaleString()}` : ''}
        </div>
      </div>
      <button className="btn" onClick={() => onDismiss(alert.alert_id)} disabled={dismissing}>
        {dismissing ? '…' : 'Dismiss'}
      </button>
    </div>
  );
}
