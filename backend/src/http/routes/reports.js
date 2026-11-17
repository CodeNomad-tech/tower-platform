'use strict';
const db = require('../../db');
const { Router } = require('../router');
const { requireAuth } = require('../../auth/auth');
const { evaluateSla, computeUptimePct } = require('../../engine/slaEngine');
const { evaluateGeneratorRuntimeTrend, evaluateFuelEfficiencyTrend } = require('../../engine/predictiveEngine');

const router = new Router();

router.get('/sla', requireAuth, (req, res) => {
  const period = Number(req.query.periodDays) || 30;
  const sites = db.all('SELECT id, name FROM sites');
  const results = sites.map(s => ({ name: s.name, ...evaluateSla(s.id, period) }));
  res.json({ periodDays: period, results });
});

router.get('/sla/breaches', requireAuth, (req, res) => {
  res.json({ breaches: db.all('SELECT * FROM sla_breaches ORDER BY ts DESC LIMIT 100') });
});

router.get('/predictive-maintenance', requireAuth, (req, res) => {
  const sites = db.all('SELECT id, name FROM sites');
  const flags = [];
  for (const s of sites) {
    const gen = evaluateGeneratorRuntimeTrend(s.id);
    const fuel = evaluateFuelEfficiencyTrend(s.id);
    if (gen) flags.push({ name: s.name, ...gen });
    if (fuel) flags.push({ name: s.name, ...fuel });
  }
  res.json({ flags });
});

router.get('/executive-summary', requireAuth, (req, res) => {
  const sites = db.all('SELECT * FROM sites');
  const totalSites = sites.length;
  const onlineSites = sites.filter(s => s.status === 'online').length;
  const openAlerts = db.get(`SELECT COUNT(*) as c FROM alerts WHERE status != 'resolved'`).c;
  const criticalAlerts = db.get(`SELECT COUNT(*) as c FROM alerts WHERE status != 'resolved' AND severity = 'critical'`).c;
  const avgUptime30d = sites.length
    ? sites.reduce((sum, s) => sum + computeUptimePct(s.id, db.toSqliteTs(new Date(Date.now() - 30 * 86400000)), db.toSqliteTs(new Date())), 0) / sites.length
    : 0;
  const totalTenants = db.get('SELECT COUNT(*) as c FROM tenants').c;
  const totalRevenue = db.get('SELECT COALESCE(SUM(contract_value_monthly),0) as s FROM tenants').s;

  res.json({
    totalSites, onlineSites, offlineSites: totalSites - onlineSites,
    openAlerts, criticalAlerts, avgUptime30d, totalTenants, totalRevenue,
  });
});

router.get('/export/uptime.csv', requireAuth, (req, res) => {
  const sites = db.all('SELECT id, name FROM sites');
  const rows = ['site_id,site_name,uptime_pct_30d'];
  for (const s of sites) {
    const pct = computeUptimePct(s.id, db.toSqliteTs(new Date(Date.now() - 30 * 86400000)), db.toSqliteTs(new Date()));
    rows.push(`${s.id},"${s.name}",${pct.toFixed(2)}`);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="uptime-report.csv"');
  res.send(rows.join('\n'));
});

router.get('/export/alerts.csv', requireAuth, (req, res) => {
  const alerts = db.all('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 1000');
  const rows = ['id,site_id,type,severity,status,message,created_at'];
  for (const a of alerts) {
    rows.push(`${a.id},${a.site_id},${a.type},${a.severity},${a.status},"${a.message.replace(/"/g, '""')}",${a.created_at}`);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="alerts-report.csv"');
  res.send(rows.join('\n'));
});

module.exports = router;
