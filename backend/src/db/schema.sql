-- Smart Tower Monitoring Platform — Database Schema
-- Engine: SQLite (node:sqlite). See docs/DATABASE.md for the full ER description
-- and the Postgres migration path for production.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator', -- 'admin' | 'operator' | 'viewer'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,             -- e.g. 'site-001'
  name TEXT NOT NULL,
  region TEXT,
  latitude REAL,
  longitude REAL,
  capacity INTEGER NOT NULL DEFAULT 4,   -- max tenants the tower can host
  status TEXT NOT NULL DEFAULT 'unknown', -- 'online' | 'offline' | 'degraded' | 'unknown'
  last_heartbeat TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw status/heartbeat log -> basis for uptime calculation
CREATE TABLE IF NOT EXISTS status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_status_log_site_ts ON status_log(site_id, ts);

CREATE TABLE IF NOT EXISTS power_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source TEXT NOT NULL,     -- 'grid' | 'solar' | 'generator'
  active INTEGER NOT NULL,  -- 1 if this source is currently supplying power
  voltage REAL,
  output_watts REAL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_power_site_ts ON power_readings(site_id, ts);

CREATE TABLE IF NOT EXISTS power_switch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_source TEXT,
  to_source TEXT NOT NULL,
  reason TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fuel_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  level_pct REAL NOT NULL,
  generator_on INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fuel_site_ts ON fuel_readings(site_id, ts);

CREATE TABLE IF NOT EXISTS generator_runtime_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event TEXT NOT NULL, -- 'start' | 'stop'
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS env_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  temperature_c REAL,
  smoke_detected INTEGER NOT NULL DEFAULT 0,
  door_open INTEGER NOT NULL DEFAULT 0,
  motion_detected INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_env_site_ts ON env_readings(site_id, ts);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,   -- 'motion' | 'intrusion' | 'unauthorized_access'
  source TEXT NOT NULL,       -- 'camera' | 'door_sensor' | 'pir'
  confidence REAL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contract_value_monthly REAL NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sla_thresholds (
  site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  target_uptime_pct REAL NOT NULL DEFAULT 99.5
);

CREATE TABLE IF NOT EXISTS sla_breaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  target_pct REAL NOT NULL,
  actual_pct REAL NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type TEXT NOT NULL,        -- 'low_fuel' | 'fuel_theft' | 'smoke' | 'intrusion' | 'unauthorized_access'
                              -- | 'equipment_health' | 'sla_breach' | 'tower_offline' | 'predictive_maintenance'
  severity TEXT NOT NULL,    -- 'info' | 'warning' | 'critical'
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- 'new' | 'acknowledged' | 'resolved'
  source_data TEXT,          -- JSON snapshot of the readings that triggered it
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  acknowledged_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_alerts_site_status ON alerts(site_id, status);

CREATE TABLE IF NOT EXISTS maintenance_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  component TEXT NOT NULL,   -- 'generator' | 'battery' | 'fuel_system'
  trend_slope REAL NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
