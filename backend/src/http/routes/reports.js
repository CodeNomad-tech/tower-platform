'use strict';
const db = require('../../db');
const { Router, HttpError } = require('../router');
const { requireAuth } = require('../../auth/auth');
const { computeSla } = require('../../engine/slaEngine');
const { siteFlags } = require('../../engine/predictiveEngine');
const { fleetIntegrity } = require('../../engine/fuelIntegrity');
const resilience = require('../../engine/resilience');
const { utilization } = require('./sites');

const router = new Router();
const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };

function periodDays(q) {
  if (q.period && PERIOD_DAYS[q.period]) return PERIOD_DAYS[q.period];
  const n = Number(q.periodDays);
  if (q.periodDays !== undefined && (!Number.isFinite(n) || n < 1 || n > 365)) throw new HttpError(400, 'periodDays must be 1–365');
  return n || 30;
}

router.get('/sla', requireAuth, (req, res) => {
  const days = periodDays(req.query);
  const results = db.all('SELECT id, name, region FROM sites ORDER BY id').map(s => ({ name: s.name, region: s.region, ...computeSla(s.id, days) }));
  const compliant = results.filter(r => !r.breached).length;
  res.json({ periodDays: days, generatedAt: new Date().toISOString(), compliant, total: results.length, results });
});

router.get('/sla/breaches', requireAuth, (req, res) => {
  res.json({ breaches: db.all('SELECT b.*, s.name FROM sla_breaches b JOIN sites s ON s.id = b.site_id ORDER BY b.ts DESC LIMIT 100') });
});

router.get('/predictive-maintenance', requireAuth, (req, res) => {
  const flags = [];
  for (const s of db.all('SELECT id, name FROM sites ORDER BY id')) for (const f of siteFlags(s.id)) flags.push({ name: s.name, ...f });
  res.json({ flags });
});

router.get('/utilization', requireAuth, (req, res) => {
  const period = PERIOD_DAYS[req.query.period] ? req.query.period : 'monthly';
  const sites = db.all('SELECT id, name FROM sites ORDER BY id').map(s => ({ name: s.name, ...utilization(s.id, period) }));
  const fleet = {};
  for (const s of sites) for (const u of s.utilization) fleet[u.source] = (fleet[u.source] || 0) + u.hours;
  const total = Object.values(fleet).reduce((a, b) => a + b, 0) || 1;
  res.json({ period, sites, fleet: Object.entries(fleet).map(([source, hours]) => ({ source, hours, pct: hours / total * 100 })) });
});

router.get('/executive-summary', requireAuth, (req, res) => {
  const sites = db.all('SELECT id, status FROM sites');
  const sla = sites.map(s => computeSla(s.id, 30));
  const open = db.get(`SELECT COUNT(*) AS n, SUM(severity = 'critical') AS c FROM alerts WHERE status != 'resolved'`);
  const rev = db.get('SELECT COUNT(*) AS n, COALESCE(SUM(contract_value_monthly), 0) AS r FROM tenants');
  const integrity = fleetIntegrity(30);
  const runway = resilience.fleetRunway();
  res.json({
    totalSites: sites.length,
    online: sites.filter(s => s.status === 'online').length,
    down: sites.filter(s => s.status === 'down').length,
    offline: sites.filter(s => s.status === 'offline').length,
    availability30d: sla.length ? sla.reduce((a, s) => a + s.actualPct, 0) / sla.length : null,
    slaCompliant: sla.filter(s => !s.breached).length,
    downtimeHours30d: sla.reduce((a, s) => a + s.downtimeHours, 0),
    openAlerts: open.n, criticalAlerts: open.c || 0,
    tenants: rev.n, monthlyRevenue: rev.r,
    fuelUnexplainedL30d: integrity.fleet.unexplainedL, fuelUnexplainedK30d: integrity.fleet.unexplainedValueK,
    atRisk24h: runway.fleet.atRisk24h, exposureK72h: runway.fleet.exposureK72h,
  });
});

// --- CSV exports (Bearer-authenticated; the console downloads them via fetch) ---
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;               // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send([header.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n'));
}

router.get('/export/sla.csv', requireAuth, (req, res) => {
  const days = periodDays(req.query);
  const rows = db.all('SELECT id, name, region FROM sites ORDER BY id').map(s => {
    const r = computeSla(s.id, days);
    return [s.id, s.name, s.region, days, r.targetPct, r.actualPct, r.downtimeHours, r.allowedDowntimeHours, r.outageEvents, r.breached ? 'BREACH' : 'COMPLIANT'];
  });
  sendCsv(res, `toweriq-sla-${days}d.csv`, ['site_id', 'site_name', 'region', 'period_days', 'target_pct', 'actual_pct', 'downtime_h', 'allowed_downtime_h', 'outage_events', 'status'], rows);
});

router.get('/export/alerts.csv', requireAuth, (req, res) => {
  const rows = db.all('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 5000').map(a =>
    [a.id, a.site_id, a.type, a.severity, a.status, a.message, a.created_at, a.acknowledged_at, a.resolved_at, a.resolution_note]);
  sendCsv(res, 'toweriq-alarms.csv', ['id', 'site_id', 'type', 'severity', 'status', 'message', 'created_utc', 'acknowledged_utc', 'resolved_utc', 'resolution_note'], rows);
});

router.get('/export/fuel.csv', requireAuth, (req, res) => {
  const r = fleetIntegrity(Math.min(365, Math.max(1, Number(req.query.days) || 30)));
  sendCsv(res, `toweriq-fuel-reconciliation-${r.days}d.csv`,
    ['site_id', 'site_name', 'opening_l', 'delivered_l', 'expected_burn_l', 'closing_l', 'unexplained_l', 'unexplained_k', 'finding'],
    r.sites.map(s => [s.siteId, s.name, s.openingL, s.deliveredL, s.expectedBurnL, s.closingL, s.unexplainedL, s.unexplainedValueK, s.findingText]));
});

module.exports = router;
