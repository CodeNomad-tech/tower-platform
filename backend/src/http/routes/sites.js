'use strict';
const db = require('../../db');
const { Router, HttpError, str, num } = require('../router');
const { requireAuth, requireRole, audit } = require('../../auth/auth');
const { computeUptimePct, computeSla } = require('../../engine/slaEngine');
const resilience = require('../../engine/resilience');
const { siteFlags } = require('../../engine/predictiveEngine');
const { reconcileSite } = require('../../engine/fuelIntegrity');

const router = new Router();
const BUCKET_15 = `substr(ts, 1, 14) || printf('%02d', (CAST(substr(ts, 15, 2) AS INTEGER) / 15) * 15)`;
const PERIODS = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };

function getSiteOr404(id) {
  const site = db.get('SELECT * FROM sites WHERE id = ?', [id]);
  if (!site) throw new HttpError(404, 'Site not found');
  return site;
}

router.get('/', requireAuth, (req, res) => {
  const sites = db.all(`
    SELECT s.*, a.tank_l, a.battery_kwh, a.solar_kw, a.gen_kw, a.load_kw,
      (SELECT level_pct FROM fuel_readings f WHERE f.site_id = s.id ORDER BY ts DESC, id DESC LIMIT 1) AS fuel_pct,
      (SELECT soc_pct FROM battery_readings b WHERE b.site_id = s.id ORDER BY ts DESC, id DESC LIMIT 1) AS battery_pct,
      (SELECT source FROM power_readings p WHERE p.site_id = s.id AND p.active = 1 ORDER BY ts DESC, id DESC LIMIT 1) AS active_source,
      (SELECT COUNT(*) FROM tenants t WHERE t.site_id = s.id) AS tenant_count,
      (SELECT COUNT(*) FROM alerts al WHERE al.site_id = s.id AND al.status != 'resolved') AS open_alerts
    FROM sites s LEFT JOIN site_assets a ON a.site_id = s.id ORDER BY s.id`);
  for (const s of sites) if (s.status === 'down') s.active_source = 'none';
  res.json({ sites });
});

router.post('/', requireRole('admin'), (req, res) => {
  const b = req.body;
  const id = str(b.id, 'Site ID', { max: 40 });
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpError(400, 'Site ID may contain only letters, digits, - and _');
  if (db.get('SELECT id FROM sites WHERE id = ?', [id])) throw new HttpError(409, `Site ${id} already exists`);
  const name = str(b.name, 'Name', { max: 120 });
  const region = str(b.region, 'Region', { max: 60, required: false });
  const lat = num(b.latitude, 'Latitude', { min: -90, max: 90, required: false });
  const lon = num(b.longitude, 'Longitude', { min: -180, max: 180, required: false });
  const capacity = num(b.capacity ?? 4, 'Capacity', { min: 1, max: 20 });
  db.tx(() => {
    db.run('INSERT INTO sites (id, name, region, latitude, longitude, capacity) VALUES (?, ?, ?, ?, ?, ?)', [id, name, region, lat, lon, capacity]);
    db.run('INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, 99.5)', [id]);
    db.run('INSERT INTO site_assets (site_id) VALUES (?)', [id]);
  });
  audit(req.user.id, 'site.create', { id, name });
  res.status(201).json({ site: db.get('SELECT * FROM sites WHERE id = ?', [id]) });
});

router.get('/:id', requireAuth, (req, res) => {
  const site = getSiteOr404(req.params.id);
  const latestPower = db.all(
    `SELECT p.source, p.active, p.voltage, p.output_watts, p.ts FROM power_readings p
      WHERE p.id IN (SELECT MAX(id) FROM power_readings WHERE site_id = ? GROUP BY source) ORDER BY p.source`, [site.id]);
  const latestFuel = db.get('SELECT * FROM fuel_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [site.id]);
  const latestBattery = db.get('SELECT * FROM battery_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [site.id]);
  const latestEnv = db.get('SELECT * FROM env_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [site.id]);
  const assets = db.get('SELECT * FROM site_assets WHERE site_id = ?', [site.id]);
  const tenants = db.all('SELECT id, name, contract_value_monthly, start_date FROM tenants WHERE site_id = ? ORDER BY name', [site.id]);
  const switches = db.all('SELECT from_source, to_source, reason, ts FROM power_switch_events WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 12', [site.id]);
  const security = db.all('SELECT event_type, source, confidence, ts FROM security_events WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 8', [site.id]);
  const now = db.toSqliteTs(Date.now());
  res.json({
    site, assets, latestPower, latestFuel, latestBattery, latestEnv, tenants, switches, security,
    uptime24h: computeUptimePct(site.id, db.toSqliteTs(Date.now() - 86400000), now),
    sla30d: computeSla(site.id, 30),
    maintenance: siteFlags(site.id),
    fuelIntegrity: reconcileSite(site.id, 30),
  });
});

router.put('/:id/assets', requireRole('admin'), (req, res) => {
  getSiteOr404(req.params.id);
  const b = req.body;
  const f = {
    load_kw: num(b.load_kw, 'Load', { min: 0.1, max: 50 }), battery_kwh: num(b.battery_kwh, 'Battery', { min: 0, max: 500 }),
    solar_kw: num(b.solar_kw, 'Solar', { min: 0, max: 200 }), tank_l: num(b.tank_l, 'Tank', { min: 0, max: 20000 }),
    gen_kw: num(b.gen_kw, 'Generator', { min: 0, max: 500 }), gen_burn_lph: num(b.gen_burn_lph, 'Burn rate', { min: 0, max: 50 }),
    refuel_lead_h: num(b.refuel_lead_h, 'Refuel lead time', { min: 0, max: 720 }),
  };
  db.run(`UPDATE site_assets SET load_kw=?, battery_kwh=?, solar_kw=?, tank_l=?, gen_kw=?, gen_burn_lph=?, refuel_lead_h=?, updated_at=datetime('now') WHERE site_id=?`,
    [f.load_kw, f.battery_kwh, f.solar_kw, f.tank_l, f.gen_kw, f.gen_burn_lph, f.refuel_lead_h, req.params.id]);
  resilience.invalidate();
  audit(req.user.id, 'site.assets', { siteId: req.params.id, ...f });
  res.json({ assets: db.get('SELECT * FROM site_assets WHERE site_id = ?', [req.params.id]) });
});

router.get('/:id/forecast', requireAuth, (req, res) => {
  getSiteOr404(req.params.id);
  const scenarioH = req.query.loadShedding ? num(req.query.loadShedding, 'loadShedding', { min: 0, max: 24 }) : null;
  const f = resilience.siteForecast(req.params.id, { scenarioH });
  if (!f) throw new HttpError(409, 'Site has no asset model configured');
  res.json(f);
});

router.get('/:id/uptime', requireAuth, (req, res) => {
  getSiteOr404(req.params.id);
  const from = req.query.from ? db.normalizeTs(req.query.from) : db.toSqliteTs(Date.now() - 30 * 86400000);
  const to = req.query.to ? db.normalizeTs(req.query.to) : db.toSqliteTs(Date.now());
  if (!from || !to) throw new HttpError(400, 'from/to must be valid dates');
  res.json({ siteId: req.params.id, from, to, uptimePct: computeUptimePct(req.params.id, from, to) });
});

// 15-minute timeline of supply source, fuel and battery, for the last N hours.
router.get('/:id/timeline', requireAuth, (req, res) => {
  getSiteOr404(req.params.id);
  const hours = num(req.query.hours ?? 24, 'hours', { min: 1, max: 24 * 7 });
  const since = db.toSqliteTs(Date.now() - hours * 3600000);
  const src = db.all(`SELECT ${BUCKET_15} AS b, source, COUNT(*) AS n FROM power_readings WHERE site_id = ? AND active = 1 AND ts >= ? GROUP BY b, source`, [req.params.id, since]);
  const anyRows = db.all(`SELECT ${BUCKET_15} AS b, COUNT(*) AS n FROM power_readings WHERE site_id = ? AND ts >= ? GROUP BY b`, [req.params.id, since]);
  const fuel = db.all(`SELECT ${BUCKET_15} AS b, AVG(level_pct) AS v, MAX(generator_on) AS gen FROM fuel_readings WHERE site_id = ? AND ts >= ? GROUP BY b`, [req.params.id, since]);
  const batt = db.all(`SELECT ${BUCKET_15} AS b, AVG(soc_pct) AS v FROM battery_readings WHERE site_id = ? AND ts >= ? GROUP BY b`, [req.params.id, since]);
  const best = new Map();
  for (const r of src) { const cur = best.get(r.b); if (!cur || r.n > cur.n) best.set(r.b, r); }
  const fm = new Map(fuel.map(r => [r.b, r])), bm = new Map(batt.map(r => [r.b, r.v]));
  const points = anyRows.map(r => ({
    ts: r.b + ':00', source: best.get(r.b)?.source || 'none',
    fuelPct: fm.get(r.b)?.v ?? null, generatorOn: !!fm.get(r.b)?.gen, batteryPct: bm.get(r.b) ?? null,
  }));
  const deliveries = db.all('SELECT litres, ts FROM fuel_deliveries WHERE site_id = ? AND ts >= ? ORDER BY ts', [req.params.id, since]);
  const theft = db.all(`SELECT created_at AS ts, message FROM alerts WHERE site_id = ? AND type = 'fuel_theft' AND created_at >= ?`, [req.params.id, since]);
  res.json({ siteId: req.params.id, hours, points, deliveries, theft });
});

// Share of TIME each source supplied the site (hour buckets, majority source), incl. dark time.
router.get('/:id/power-utilization', requireAuth, (req, res) => {
  getSiteOr404(req.params.id);
  const period = PERIODS[req.query.period] ? req.query.period : 'weekly';
  res.json(utilization(req.params.id, period));
});

function utilization(siteId, period) {
  const days = PERIODS[period];
  const since = db.toSqliteTs(Date.now() - days * 86400000);
  const rows = db.all(`SELECT substr(ts, 1, 13) AS h, source, COUNT(*) AS n FROM power_readings WHERE site_id = ? AND active = 1 AND ts >= ? GROUP BY h, source`, [siteId, since]);
  const hoursSeen = db.all(`SELECT substr(ts, 1, 13) AS h FROM power_readings WHERE site_id = ? AND ts >= ? GROUP BY h`, [siteId, since]);
  const best = new Map();
  for (const r of rows) { const c = best.get(r.h); if (!c || r.n > c.n) best.set(r.h, r); }
  const counts = { grid: 0, solar: 0, battery: 0, generator: 0, dark: 0 };
  for (const { h } of hoursSeen) { const b = best.get(h); counts[b ? b.source : 'dark']++; }
  const total = hoursSeen.length || 1;
  const first = db.get('SELECT MIN(ts) AS t FROM power_readings WHERE site_id = ?', [siteId])?.t;
  const coverageDays = first ? Math.min(days, (Date.now() - db.tsToMs(first)) / 86400000) : 0;
  return {
    siteId, period, periodDays: days, coverageDays, hours: hoursSeen.length,
    utilization: Object.entries(counts).map(([source, n]) => ({ source, hours: n, pct: (n / total) * 100 })),
  };
}

router.get('/:id/fuel-history', requireAuth, (req, res) => {
  getSiteOr404(req.params.id);
  const from = req.query.from ? db.normalizeTs(req.query.from) : db.toSqliteTs(Date.now() - 86400000);
  const to = req.query.to ? db.normalizeTs(req.query.to) : db.toSqliteTs(Date.now());
  if (!from || !to) throw new HttpError(400, 'from/to must be valid dates');
  const rows = db.all(`SELECT ${BUCKET_15} AS b, AVG(level_pct) AS level_pct, MAX(generator_on) AS generator_on FROM fuel_readings WHERE site_id = ? AND ts BETWEEN ? AND ? GROUP BY b ORDER BY b`, [req.params.id, from, to]);
  res.json({ readings: rows.map(r => ({ ts: r.b + ':00', level_pct: r.level_pct, generator_on: r.generator_on })) });
});

module.exports = router;
module.exports.utilization = utilization;
