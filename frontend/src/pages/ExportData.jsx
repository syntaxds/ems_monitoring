import React, { useState } from 'react';
import { getDevices, generateReport } from '../services/api';

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

export default function ExportData() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');

  // Live count from the DB once both dates are chosen.
  const loadPreview = async (s, e) => {
    if (!s || !e) {
      setPreview(null);
      return;
    }
    setLoadingPreview(true);
    setError('');
    try {
      const { data } = await getDevices();
      setPreview({
        total: data.length,
        active: data.filter((d) => d.status === 'active').length,
        idle: data.filter((d) => d.status === 'idle').length,
        anomalies: data.filter((d) => d.status === 'anomaly').length
      });
    } catch (err) {
      setError('Failed to load preview');
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const onStart = (v) => {
    setStartDate(v);
    loadPreview(v, endDate);
  };
  const onEnd = (v) => {
    setEndDate(v);
    loadPreview(startDate, v);
  };

  const doExport = async (format) => {
    if (!startDate || !endDate) {
      setError('Select a start and end date first');
      return;
    }
    setExporting(format);
    setError('');
    try {
      const res = await generateReport({
        start_date: startDate,
        end_date: endDate,
        format
      });
      const ext = format === 'pdf' ? 'pdf' : 'csv';
      triggerDownload(res.data, `ems_report_${startDate}_to_${endDate}.${ext}`);
    } catch (err) {
      setError('Export failed. Please try again.');
    } finally {
      setExporting('');
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Export Data</h1>

      <div className="chart-panel">
        <h3>Report Range</h3>
        <div className="controls-row">
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#9a9a9a', marginBottom: 6 }}>
              Start Date
            </label>
            <input
              type="date"
              className="date-input"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => onStart(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#9a9a9a', marginBottom: 6 }}>
              End Date
            </label>
            <input
              type="date"
              className="date-input"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => onEnd(e.target.value)}
            />
          </div>
        </div>

        {error && <div className="login-error" style={{ maxWidth: 420 }}>{error}</div>}

        {startDate && endDate && (
          <>
            <h3 style={{ marginTop: 18 }}>Preview</h3>
            {loadingPreview ? (
              <div className="spinner">Counting…</div>
            ) : preview ? (
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>Range</th>
                    <th>Total Devices</th>
                    <th>Active</th>
                    <th>Idle</th>
                    <th>With Anomalies</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{startDate} → {endDate}</td>
                    <td>{preview.total}</td>
                    <td>{preview.active}</td>
                    <td>{preview.idle}</td>
                    <td>{preview.anomalies}</td>
                  </tr>
                </tbody>
              </table>
            ) : null}
          </>
        )}

        <div className="controls-row" style={{ marginTop: 8 }}>
          <button
            className="btn"
            onClick={() => doExport('csv')}
            disabled={!startDate || !endDate || exporting !== ''}
          >
            {exporting === 'csv' ? 'Exporting…' : 'Export as CSV'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => doExport('pdf')}
            disabled={!startDate || !endDate || exporting !== ''}
          >
            {exporting === 'pdf' ? 'Exporting…' : 'Export as PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
