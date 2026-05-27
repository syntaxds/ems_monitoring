import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

// Renders the fuel-level-over-time line chart. `data` is an array of
// { time, fuel_level } points (time already formatted for the axis).
export default function FuelChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No data available for selected range</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#333" strokeDasharray="3 3" />
        <XAxis dataKey="time" stroke="#9a9a9a" tick={{ fontSize: 12 }} minTickGap={24} />
        <YAxis stroke="#9a9a9a" tick={{ fontSize: 12 }} unit=" L" width={60} />
        <Tooltip
          contentStyle={{ background: '#232323', border: '1px solid #383838', color: '#e8e8e8' }}
          labelStyle={{ color: '#9a9a9a' }}
        />
        <Line
          type="monotone"
          dataKey="fuel_level"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          name="Fuel Level"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
