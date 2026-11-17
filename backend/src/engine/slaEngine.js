'use strict';
/**
 * SLA engine: uptime % reconstructed from status transitions (status_log).
 * A site counts as UP only while status = 'online'. 'down' (no power) and
 * 'offline' (no comms, conservatively treated as down) count against SLA.
 */

const db = require('../db');
const { createAlert } = require('./ruleEngine');

function computeUptimePct(siteId, fromTs, toTs) {
  const r = downtimeMs(siteId, fromTs, toTs);
  if (r.totalMs <= 0) return 100;
  return Math.max(0, Math.min(100, 100 * (1 - r.downMs / r.totalMs)));
}

// Returns { downMs, totalMs, events } for the window. Only reads the rows it needs.
function downtimeMs(siteId, fromTs, toTs) {
  const fromMs = db.tsToMs(fromTs), toMs = db.tsToMs(toTs);
  const before = db.get('SELECT status FROM status_log WHERE site_id = ? AND ts < ? ORDER BY ts DESC, id DESC LIMIT 1', [siteId, fromTs]);
  const rows = db.all('SELECT status, ts FROM status_log WHERE site_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id', [siteId, fromTs, toTs]);
  let status = before ? before.status : 'online';
  let cursor = fromMs, downMs = 0, events = 0;
  for (const row of rows) {
    const t = db.tsToMs(row.ts);
    if (status !== 'online') downMs += t - cursor;
    if (row.status !== 'online' && status === 'online') events++;
    cursor = t;
    status = row.status;
  }
  if (status !== 'online') downMs += toMs - cursor;
  return { downMs, totalMs: toMs - fromMs, events };
}

function slaTarget(siteId) {
  return db.get('SELECT target_uptime_pct FROM sla_thresholds WHERE site_id = ?', [siteId])?.target_uptime_pct ?? 99.5;
}

// Pure computation. Safe to call from GET handlers.
function computeSla(siteId, periodDays = 30) {
  const toTs = db.toSqliteTs(Date.now());
  const fromTs = db.toSqliteTs(Date.now() - periodDays * 86400000);
  const { downMs, totalMs, events } = downtimeMs(siteId, fromTs, toTs);
  const actualPct = totalMs > 0 ? 100 * (1 - downMs / totalMs) : 100;
  const targetPct = slaTarget(siteId);
  const allowedDownH = (totalMs / 3600000) * (1 - targetPct / 100);
  return {
    siteId, periodDays, fromTs, toTs, actualPct, targetPct,
    downtimeHours: downMs / 3600000, allowedDowntimeHours: allowedDownH, outageEvents: events,
    breached: actualPct < targetPct,
  };
}

// Background job only: records a breach (at most one per site per day) and raises an alarm.
function recordSlaBreach(siteId, periodDays = 30) {
  const r = computeSla(siteId, periodDays);
  if (!r.breached) return r;
  const today = db.get(`SELECT id FROM sla_breaches WHERE site_id = ? AND ts >= datetime('now', '-1 day')`, [siteId]);
  if (!today) {
    db.run('INSERT INTO sla_breaches (site_id, period_start, period_end, target_pct, actual_pct) VALUES (?, ?, ?, ?, ?)',
      [siteId, r.fromTs, r.toTs, r.targetPct, r.actualPct]);
  }
  r.alert = createAlert({
    siteId, type: 'sla_breach', severity: 'warning',
    message: `SLA breach: ${r.actualPct.toFixed(2)}% availability over ${periodDays} days (target ${r.targetPct}%), ${r.downtimeHours.toFixed(1)} h down vs ${r.allowedDowntimeHours.toFixed(1)} h allowed`,
    sourceData: { actualPct: r.actualPct, targetPct: r.targetPct, periodDays },
  });
  return r;
}

module.exports = { computeUptimePct, downtimeMs, computeSla, recordSlaBreach, slaTarget };
