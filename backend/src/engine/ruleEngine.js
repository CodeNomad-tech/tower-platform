'use strict';
/**
 * Rule engine — evaluates incoming telemetry against thresholds and writes
 * alert records. This is deliberately the ONE place alert logic lives, so
 * every alert type (fuel, security, environmental, SLA, predictive) flows
 * through the same pipeline: rule fires -> alert row created -> broadcast
 * over WebSocket -> visible in the live alert feed -> acknowledge/resolve
 * lifecycle persists in the DB.
 */

const db = require('../db');

const THRESHOLDS = {
  LOW_FUEL_PCT: 20,
  FUEL_THEFT_DROP_PCT: 15,     // drop of this many % within the window below...
  FUEL_THEFT_WINDOW_MIN: 10,   // ...minutes, while generator is OFF, is theft
  SMOKE_IS_ALWAYS_CRITICAL: true,
  HIGH_TEMP_C: 45,
  OFFLINE_TIMEOUT_MIN: 3,      // no heartbeat in this many minutes = offline
};

function createAlert({ siteId, type, severity, message, sourceData }) {
  // Avoid spamming duplicate unresolved alerts of the same type for the same site
  const existing = db.get(
    `SELECT id FROM alerts WHERE site_id = ? AND type = ? AND status != 'resolved'
     ORDER BY created_at DESC LIMIT 1`,
    [siteId, type]
  );
  if (existing) return null;

  const result = db.run(
    `INSERT INTO alerts (site_id, type, severity, message, source_data) VALUES (?, ?, ?, ?, ?)`,
    [siteId, type, severity, message, JSON.stringify(sourceData || {})]
  );
  return db.get('SELECT * FROM alerts WHERE id = ?', [result.lastInsertRowid]);
}

function evaluateFuel(siteId, reading) {
  const alerts = [];

  if (reading.level_pct <= THRESHOLDS.LOW_FUEL_PCT) {
    const a = createAlert({
      siteId, type: 'low_fuel', severity: reading.level_pct <= 10 ? 'critical' : 'warning',
      message: `Fuel level at ${reading.level_pct.toFixed(1)}% (threshold ${THRESHOLDS.LOW_FUEL_PCT}%)`,
      sourceData: reading,
    });
    if (a) alerts.push(a);
  }

  // Theft detection: compare against readings from the configured window
  const windowStart = db.toSqliteTs(new Date(Date.now() - THRESHOLDS.FUEL_THEFT_WINDOW_MIN * 60 * 1000));
  const prior = db.get(
    `SELECT * FROM fuel_readings WHERE site_id = ? AND ts >= ? ORDER BY ts ASC LIMIT 1`,
    [siteId, windowStart]
  );
  if (prior && reading.generator_on === 0 && prior.generator_on === 0) {
    const drop = prior.level_pct - reading.level_pct;
    if (drop >= THRESHOLDS.FUEL_THEFT_DROP_PCT) {
      const a = createAlert({
        siteId, type: 'fuel_theft', severity: 'critical',
        message: `Fuel dropped ${drop.toFixed(1)}% in ~${THRESHOLDS.FUEL_THEFT_WINDOW_MIN} min while generator was OFF — possible theft`,
        sourceData: { prior, reading },
      });
      if (a) alerts.push(a);
    }
  }
  return alerts;
}

function evaluateEnv(siteId, reading) {
  const alerts = [];
  if (reading.smoke_detected) {
    const a = createAlert({
      siteId, type: 'smoke', severity: 'critical',
      message: 'Smoke/fire detected at site',
      sourceData: reading,
    });
    if (a) alerts.push(a);
  }
  if (reading.temperature_c != null && reading.temperature_c >= THRESHOLDS.HIGH_TEMP_C) {
    const a = createAlert({
      siteId, type: 'equipment_health', severity: 'warning',
      message: `Cabinet temperature ${reading.temperature_c.toFixed(1)}°C exceeds safe threshold (${THRESHOLDS.HIGH_TEMP_C}°C)`,
      sourceData: reading,
    });
    if (a) alerts.push(a);
  }
  return alerts;
}

function evaluateSecurity(siteId, event) {
  const alerts = [];
  if (event.event_type === 'intrusion' || event.event_type === 'unauthorized_access') {
    const a = createAlert({
      siteId, type: event.event_type, severity: 'critical',
      message: `${event.event_type === 'intrusion' ? 'Intrusion' : 'Unauthorized access'} detected via ${event.source} (confidence ${(event.confidence ?? 0).toFixed(2)})`,
      sourceData: event,
    });
    if (a) alerts.push(a);
  }
  return alerts;
}

function checkOfflineSites() {
  const cutoff = db.toSqliteTs(new Date(Date.now() - THRESHOLDS.OFFLINE_TIMEOUT_MIN * 60 * 1000));
  const sites = db.all('SELECT * FROM sites');
  const alerts = [];
  for (const site of sites) {
    const isStale = !site.last_heartbeat || site.last_heartbeat < cutoff;
    const newStatus = isStale ? 'offline' : 'online';
    if (newStatus !== site.status) {
      db.run('UPDATE sites SET status = ? WHERE id = ?', [newStatus, site.id]);
      db.run('INSERT INTO status_log (site_id, status) VALUES (?, ?)', [site.id, newStatus]);
      if (newStatus === 'offline') {
        const a = createAlert({
          siteId: site.id, type: 'tower_offline', severity: 'critical',
          message: `No heartbeat received in over ${THRESHOLDS.OFFLINE_TIMEOUT_MIN} minutes`,
          sourceData: { last_heartbeat: site.last_heartbeat },
        });
        if (a) alerts.push(a);
      } else {
        // back online -> auto-resolve any open offline alert
        db.run(
          `UPDATE alerts SET status = 'resolved', resolved_at = datetime('now')
           WHERE site_id = ? AND type = 'tower_offline' AND status != 'resolved'`,
          [site.id]
        );
      }
    }
  }
  return alerts;
}

module.exports = { evaluateFuel, evaluateEnv, evaluateSecurity, checkOfflineSites, createAlert, THRESHOLDS };
