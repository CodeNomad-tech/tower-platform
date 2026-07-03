'use strict';
const db = require('../../db');
const { Router, HttpError } = require('../router');
const { requireAuth } = require('../../auth/auth');
const { computeUptimePct } = require('../../engine/slaEngine');

const router = new Router();

router.get('/', requireAuth, (req, res) => {
  const sites = db.all('SELECT * FROM sites ORDER BY name');
  res.json({ sites });
});

router.post('/', requireAuth, (req, res) => {
  const { id, name, region, latitude, longitude, capacity } = req.body;
  if (!id || !name) throw new HttpError(400, 'id and name are required');
  db.run(
    'INSERT INTO sites (id, name, region, latitude, longitude, capacity) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, region ?? null, latitude ?? null, longitude ?? null, capacity ?? 4]
  );
  db.run('INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, 99.5)', [id]);
  res.status(201).json({ site: db.get('SELECT * FROM sites WHERE id = ?', [id]) });
});

router.get('/:id', requireAuth, (req, res) => {
  const site = db.get('SELECT * FROM sites WHERE id = ?', [req.params.id]);
  if (!site) throw new HttpError(404, 'Site not found');

  const latestPower = db.all(
    `SELECT source, active, voltage, output_watts, ts FROM power_readings
     WHERE site_id = ? AND ts = (SELECT MAX(ts) FROM power_readings p2 WHERE p2.site_id = power_readings.site_id AND p2.source = power_readings.source)
     ORDER BY source`, [site.id]
  );
  const latestFuel = db.get('SELECT * FROM fuel_readings WHERE site_id = ? ORDER BY ts DESC LIMIT 1', [site.id]);
  const latestEnv = db.get('SELECT * FROM env_readings WHERE site_id = ? ORDER BY ts DESC LIMIT 1', [site.id]);
  const uptime24h = computeUptimePct(site.id, db.toSqliteTs(new Date(Date.now() - 86400000)), db.toSqliteTs(new Date()));
  const tenantCount = db.get('SELECT COUNT(*) as c FROM tenants WHERE site_id = ?', [site.id]).c;

  res.json({ site, latestPower, latestFuel, latestEnv, uptime24h, tenantCount });
});

router.get('/:id/uptime', requireAuth, (req, res) => {
  const { from, to } = req.query;
  const fromIso = from ? db.normalizeTs(from) : db.toSqliteTs(new Date(Date.now() - 30 * 86400000));
  const toIso = to ? db.normalizeTs(to) : db.toSqliteTs(new Date());
  const pct = computeUptimePct(req.params.id, fromIso, toIso);
  res.json({ siteId: req.params.id, from: fromIso, to: toIso, uptimePct: pct });
});

router.get('/:id/power-history', requireAuth, (req, res) => {
  const { from, to, source } = req.query;
  const fromIso = from ? db.normalizeTs(from) : db.toSqliteTs(new Date(Date.now() - 86400000));
  const toIso = to ? db.normalizeTs(to) : db.toSqliteTs(new Date());
  let sql = 'SELECT * FROM power_readings WHERE site_id = ? AND ts BETWEEN ? AND ?';
  const params = [req.params.id, fromIso, toIso];
  if (source) { sql += ' AND source = ?'; params.push(source); }
  sql += ' ORDER BY ts ASC';
  res.json({ readings: db.all(sql, params) });
});

router.get('/:id/fuel-history', requireAuth, (req, res) => {
  const { from, to } = req.query;
  const fromIso = from ? db.normalizeTs(from) : db.toSqliteTs(new Date(Date.now() - 86400000));
  const toIso = to ? db.normalizeTs(to) : db.toSqliteTs(new Date());
  res.json({ readings: db.all(
    'SELECT * FROM fuel_readings WHERE site_id = ? AND ts BETWEEN ? AND ? ORDER BY ts ASC',
    [req.params.id, fromIso, toIso]
  )});
});

router.get('/:id/power-utilization', requireAuth, (req, res) => {
  // Utilization = share of readings where each source was active, within period
  const { period } = req.query; // 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  const days = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, yearly: 365 }[period] || 7;
  const since = db.toSqliteTs(new Date(Date.now() - days * 86400000));
  const rows = db.all(
    `SELECT source, COUNT(*) as active_count FROM power_readings
     WHERE site_id = ? AND active = 1 AND ts >= ? GROUP BY source`,
    [req.params.id, since]
  );
  const total = rows.reduce((s, r) => s + r.active_count, 0) || 1;
  const utilization = rows.map(r => ({ source: r.source, pct: (r.active_count / total) * 100 }));
  res.json({ siteId: req.params.id, period: period || 'weekly', utilization });
});

module.exports = router;
