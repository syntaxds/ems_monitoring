-- EMS (Excavator Monitoring System) initial schema.
-- Idempotent: safe to run on every startup. Never drops data.

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'supervisor', 'director')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  device_id VARCHAR(50) PRIMARY KEY,
  device_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'idle' CHECK (status IN ('active', 'idle', 'anomaly')),
  operator_name VARCHAR(100),
  device_token VARCHAR(100),
  user_id INT REFERENCES users(user_id),
  installed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fuel_data (
  fuel_id SERIAL PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES devices(device_id) ON DELETE CASCADE,
  fuel_level FLOAT NOT NULL,
  engine_status VARCHAR(20) CHECK (engine_status IN ('running', 'idle', 'off')),
  voltage FLOAT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_data_device_time ON fuel_data(device_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS gps_data (
  gps_id SERIAL PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES devices(device_id) ON DELETE CASCADE,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_data_device_time ON gps_data(device_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS camera_data (
  image_id SERIAL PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES devices(device_id) ON DELETE CASCADE,
  image_path VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_camera_data_device_time ON camera_data(device_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id SERIAL PRIMARY KEY,
  device_id VARCHAR(50) REFERENCES devices(device_id) ON DELETE CASCADE,
  alert_type VARCHAR(50) NOT NULL,
  alert_message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged')),
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_time ON alerts(status, timestamp DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  log_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id),
  action VARCHAR(100) NOT NULL,
  description TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  report_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  format VARCHAR(10) NOT NULL CHECK (format IN ('pdf', 'csv')),
  generated_at TIMESTAMP DEFAULT NOW()
);
