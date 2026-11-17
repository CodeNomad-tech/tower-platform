'use strict';
/**
 * Rule engine: the single place where telemetry becomes alarms.
 * rule fires → alert row → WebSocket broadcast → operator acknowledges/resolves.
 * Duplicate open alarms of the same type for the same site are suppressed.
 */

const db = require('../db');

const THRESHOLDS = {
  LOW_FUEL_PCT: 20,
  CRITICAL_FUEL_PCT: 10,
  THEFT_WINDOW_MIN: 15,        // look-back window for a sudden drop...
  THEFT_MIN_LITRES: 40,        // ...of at least this many litres
  THEFT_MIN_TANK_PCT: 8,       // ...or this % of the tank (whichever is larger), generator OFF throughout
  HIGH_TEMP_C: 45,
  OFFLINE_TIMEOUT_MIN: 3,      // no telemetry for this long = comms lost
};

function createAlert({ siteId, type, severity, message, sourceData }) {
  const existing = db.get(`SELECT id FROM alerts WHERE site_id = ? AND type = ? AND status != 'resolved' LIMIT 1`, [siteId, type]);
  if (existing) return null;
  const r = db.run('INSERT INTO alerts (site_id, type, severity, message, source_data) VALUES (?, ?, ?, ?, ?)',
    [siteId, type, severity, message, JSON.stringify(sourceData || {})]);
  return db.get('SELECT * FROM alerts WHERE id = ?', [r.lastInsertRowid]);
}

function autoResolve(siteId, type, note) {
  const open = db.all(`SELECT id FROM alerts WHERE site_id = ? AND type = ? AND status != 'resolved'`, [siteId, type]);
  for (const a of open) {
    db.run(`UPDATE alerts SET status = 'resolved', resolved_at = datetime('now'), resolution_note = ? WHERE id = ?`, [note, a.id]);
  }
  return open.map(a => a.id);
}

function tankLitres(siteId) {
  return db.get('SELECT tank_l FROM site_assets WHERE site_id = ?', [siteId])?.tank_l || null;
}

// reading: { level_pct, generator_on }. Call AFTER the reading is persisted.
function evaluateFuel(siteId, reading) {
  const alerts = [];
  const tank = tankLitres(siteId);
  const litres = tank ? (reading.level_pct / 100) * tank : null;
  const litresTxt = litres != null ? ` (${Math.round(litres)} L)` : '';

  if (reading.level_pct <= THRESHOLDS.LOW_FUEL_PCT) {
    const a = createAlert({
      siteId, type: 'low_fuel', severity: reading.level_pct <= THRESHOLDS.CRITICAL_FUEL_PCT ? 'critical' : 'warning',
      message: `Fuel at ${reading.level_pct.toFixed(0)}%${litresTxt}, threshold ${THRESHOLDS.LOW_FUEL_PCT}%`,
      sourceData: reading,
    });
    if (a) alerts.push(a);
  } else if (reading.level_pct >= 50) {
    autoResolve(siteId, 'low_fuel', 'Auto-resolved: fuel level restored');
  }

  // Sudden drop with the generator OFF for the whole window = possible theft.
  const since = db.toSqliteTs(Date.now() - THRESHOLDS.THEFT_WINDOW_MIN * 60000);
  const window = db.get(
    `SELECT MAX(level_pct) AS peak, MAX(generator_on) AS gen_ran FROM fuel_readings WHERE site_id = ? AND ts >= ?`, [siteId, since]);
  if (window && window.peak != null && !window.gen_ran && !reading.generator_on) {
    const dropPct = window.peak - reading.level_pct;
    const dropL = tank ? (dropPct / 100) * tank : null;
    const minPct = tank ? Math.max(THRESHOLDS.THEFT_MIN_TANK_PCT, (THRESHOLDS.THEFT_MIN_LITRES / tank) * 100) : 15;
    if (dropPct >= minPct) {
      const a = createAlert({
        siteId, type: 'fuel_theft', severity: 'critical',
        message: `Fuel dropped ${dropL != null ? Math.round(dropL) + ' L' : dropPct.toFixed(0) + '%'} in under ${THRESHOLDS.THEFT_WINDOW_MIN} min with the generator OFF: possible theft`,
        sourceData: { peak_pct: window.peak, now_pct: reading.level_pct, litres: dropL != null ? Math.round(dropL) : null },
      });
      if (a) alerts.push(a);
    }
  }
  return alerts;
}

function evaluateEnv(siteId, reading) {
  const alerts = [];
  if (reading.smoke_detected) {
    const a = createAlert({ siteId, type: 'smoke', severity: 'critical', message: 'Smoke/fire detected in equipment shelter', sourceData: reading });
    if (a) alerts.push(a);
  }
  if (reading.temperature_c != null && reading.temperature_c >= THRESHOLDS.HIGH_TEMP_C) {
    const a = createAlert({
      siteId, type: 'equipment_health', severity: 'warning',
      message: `Shelter temperature ${Number(reading.temperature_c).toFixed(1)}°C exceeds ${THRESHOLDS.HIGH_TEMP_C}°C`, sourceData: reading,
    });
    if (a) alerts.push(a);
  }
  if (reading.door_open && reading.motion_detected) {
    const a = createAlert({ siteId, type: 'unauthorized_access', severity: 'warning', message: 'Shelter door opened with motion inside: no visit scheduled', sourceData: reading });
    if (a) alerts.push(a);
  }
  return alerts;
}

const SECURITY_TYPES = new Set(['motion', 'intrusion', 'unauthorized_access']);

function evaluateSecurity(siteId, event) {
  const alerts = [];
  if (event.event_type === 'intrusion' || event.event_type === 'unauthorized_access') {
    const conf = Number(event.confidence);
    const a = createAlert({
      siteId, type: event.event_type, severity: 'critical',
      message: `${event.event_type === 'intrusion' ? 'Intrusion' : 'Unauthorised access'} detected via ${event.source}${Number.isFinite(conf) ? ` (confidence ${conf.toFixed(2)})` : ''}`,
      sourceData: event,
    });
    if (a) alerts.push(a);
  }
  return alerts;
}

// Power state change reported by the site controller (see ingest heartbeat `powered`).
function evaluatePowerState(siteId, powered) {
  if (!powered) {
    const a = createAlert({ siteId, type: 'site_down', severity: 'critical', message: 'Site lost all power: tenants are off air', sourceData: {} });
    return a ? [a] : [];
  }
  autoResolve(siteId, 'site_down', 'Auto-resolved: power restored');
  return [];
}

function checkOfflineSites() {
  const cutoff = db.toSqliteTs(Date.now() - THRESHOLDS.OFFLINE_TIMEOUT_MIN * 60000);
  const stale = db.all(`SELECT id, last_heartbeat FROM sites WHERE status != 'offline' AND (last_heartbeat IS NULL OR last_heartbeat < ?)`, [cutoff]);
  const alerts = [];
  for (const site of stale) {
    db.run(`UPDATE sites SET status = 'offline' WHERE id = ?`, [site.id]);
    db.run(`INSERT INTO status_log (site_id, status) VALUES (?, 'offline')`, [site.id]);
    const a = createAlert({
      siteId: site.id, type: 'comms_lost', severity: 'critical',
      message: `No telemetry for over ${THRESHOLDS.OFFLINE_TIMEOUT_MIN} minutes: site controller unreachable`,
      sourceData: { last_heartbeat: site.last_heartbeat },
    });
    if (a) alerts.push(a);
  }
  return alerts;
}

module.exports = {
  createAlert, autoResolve, evaluateFuel, evaluateEnv, evaluateSecurity, evaluatePowerState, checkOfflineSites,
  THRESHOLDS, SECURITY_TYPES,
};
