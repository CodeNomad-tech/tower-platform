-- TowerIQ: database schema (SQLite via node:sqlite).
-- Timestamps are UTC text 'YYYY-MM-DD HH:MM:SS' (see db/index.js toSqliteTs).
-- See docs/DATABASE.md for the ER description and Postgres migration path.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator','viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  latitude REAL,
  longitude REAL,
  capacity INTEGER NOT NULL DEFAULT 4,     -- max tenants the tower can host
  status TEXT NOT NULL DEFAULT 'unknown',  -- 'online' | 'down' (no power) | 'offline' (no comms) | 'unknown'
  last_heartbeat TEXT,
  simulated INTEGER NOT NULL DEFAULT 0,    -- 1 = created by demo mode; shown as simulated in UI
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Energy asset model per site: what the digital twin / resilience engine reasons over.
CREATE TABLE IF NOT EXISTS site_assets (
  site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  load_kw REAL NOT NULL DEFAULT 2.0,          -- average DC+cooling load
  battery_kwh REAL NOT NULL DEFAULT 0,        -- usable battery capacity
  solar_kw REAL NOT NULL DEFAULT 0,           -- installed PV peak
  tank_l REAL NOT NULL DEFAULT 1000,          -- diesel tank capacity
  gen_kw REAL NOT NULL DEFAULT 0,             -- 0 = no generator
  gen_burn_lph REAL NOT NULL DEFAULT 2.0,     -- nameplate burn at site load (commissioning value)
  grid_profile TEXT NOT NULL DEFAULT 'A',     -- load-shedding group (demo schedules)
  refuel_lead_h REAL NOT NULL DEFAULT 36,     -- typical hours from refuel request to delivery
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  source TEXT NOT NULL,     -- 'grid' | 'solar' | 'battery' | 'generator'
  active INTEGER NOT NULL,  -- 1 if this source is the primary supply right now
  voltage REAL,
  output_watts REAL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_power_site_ts ON power_readings(site_id, ts);
CREATE INDEX IF NOT EXISTS idx_power_site_source_ts ON power_readings(site_id, source, ts);

CREATE TABLE IF NOT EXISTS power_switch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_source TEXT,
  to_source TEXT NOT NULL,  -- includes 'none' when the site goes dark
  reason TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_switch_site_ts ON power_switch_events(site_id, ts);

CREATE TABLE IF NOT EXISTS battery_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  soc_pct REAL NOT NULL,
  voltage REAL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_battery_site_ts ON battery_readings(site_id, ts);

CREATE TABLE IF NOT EXISTS fuel_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  level_pct REAL NOT NULL,
  generator_on INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fuel_site_ts ON fuel_readings(site_id, ts);

CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  litres REAL NOT NULL CHECK (litres > 0),
  supplier TEXT,
  reference TEXT,
  recorded_by INTEGER REFERENCES users(id),
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deliveries_site_ts ON fuel_deliveries(site_id, ts);

CREATE TABLE IF NOT EXISTS generator_runtime_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('start','stop')),
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_genlog_site_ts ON generator_runtime_log(site_id, ts);

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
  source TEXT NOT NULL,       -- 'camera' | 'door_sensor' | 'pir' | 'hardware_sensor'
  confidence REAL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_site_ts ON security_events(site_id, ts);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contract_value_monthly REAL NOT NULL DEFAULT 0 CHECK (contract_value_monthly >= 0),
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
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','resolved')),
  source_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  acknowledged_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_site_status ON alerts(site_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

CREATE TABLE IF NOT EXISTS maintenance_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  trend_slope REAL NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Editable business assumptions (diesel price, SLA credit multiplier, capex unit costs...).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Field devices (e.g. phone camera nodes) authenticate with a key, not a user session.
CREATE TABLE IF NOT EXISTS device_keys (
  key_hash TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Who changed what (configuration, alarms, deliveries, demo scenarios).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
