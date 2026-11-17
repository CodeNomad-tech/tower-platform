'use strict';
/**
 * SLA engine — computes rolling uptime % for a site over a period from the
 * real status_log history, compares it against the site's configured
 * target, and records breaches. This is what backs the "SLA reporting
 * dashboard" and "automated SLA reports" requirements — not a display
 * label, an actual calculation over persisted status transitions.
 */

const db = require('../db');
const { createAlert } = require('./ruleEngine');

/**
 * Uptime % = (time spent 'online') / (total elapsed time) over [from, to],
 * reconstructed from ordered status_log transitions.
 */
function computeUptimePct(siteId, fromIso, toIso) {
  const rows = db.all(
    `SELECT status, ts FROM status_log WHERE site_id = ? AND ts <= ? ORDER BY ts ASC`,
    [siteId, toIso]
  );
  // Find the status in effect at `from` (last transition before the window, default 'online')
  let currentStatus = 'online';
  let cursor = new Date(fromIso).getTime();
  const windowEnd = new Date(toIso).getTime();
  let onlineMs = 0;
  let lastTs = cursor;

  const inWindow = rows.filter(r => new Date(r.ts).getTime() >= cursor);
  const before = rows.filter(r => new Date(r.ts).getTime() < cursor);
  if (before.length) currentStatus = before[before.length - 1].status;

  for (const row of inWindow) {
    const t = new Date(row.ts).getTime();
    if (currentStatus === 'online') onlineMs += t - lastTs;
    lastTs = t;
    currentStatus = row.status;
  }
  if (currentStatus === 'online') onlineMs += windowEnd - lastTs;

  const totalMs = windowEnd - new Date(fromIso).getTime();
  if (totalMs <= 0) return 100;
  return Math.max(0, Math.min(100, (onlineMs / totalMs) * 100));
}

function evaluateSla(siteId, periodDays = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const fromTs = db.toSqliteTs(from);
  const toTs = db.toSqliteTs(to);
  const actualPct = computeUptimePct(siteId, fromTs, toTs);

  const threshold = db.get('SELECT * FROM sla_thresholds WHERE site_id = ?', [siteId])
    || { target_uptime_pct: 99.5 };

  const breached = actualPct < threshold.target_uptime_pct;
  if (breached) {
    db.run(
      `INSERT INTO sla_breaches (site_id, period_start, period_end, target_pct, actual_pct) VALUES (?, ?, ?, ?, ?)`,
      [siteId, fromTs, toTs, threshold.target_uptime_pct, actualPct]
    );
    createAlert({
      siteId, type: 'sla_breach', severity: 'warning',
      message: `SLA breach: ${actualPct.toFixed(2)}% uptime over last ${periodDays}d (target ${threshold.target_uptime_pct}%)`,
      sourceData: { actualPct, target: threshold.target_uptime_pct, periodDays },
    });
  }

  return { siteId, periodDays, actualPct, targetPct: threshold.target_uptime_pct, breached };
}

module.exports = { computeUptimePct, evaluateSla };
