'use strict';
const db = require('../../db');
const { Router, HttpError, str, num } = require('../router');
const { requireAuth, requireRole, audit } = require('../../auth/auth');
const { computeSla } = require('../../engine/slaEngine');
const settings = require('../../settings');

const router = new Router();

function avgContract() {
  return db.get('SELECT AVG(contract_value_monthly) AS v FROM tenants')?.v || 0;
}

router.get('/', requireAuth, (req, res) => {
  const sites = db.all('SELECT id, name, region, capacity FROM sites ORDER BY id');
  const avg = avgContract();
  const mult = settings.get('sla_credit_multiplier');
  const summary = sites.map(site => {
    const tenants = db.all('SELECT id, name, contract_value_monthly FROM tenants WHERE site_id = ? ORDER BY name', [site.id]);
    const monthlyRevenue = tenants.reduce((s, t) => s + t.contract_value_monthly, 0);
    const sla = computeSla(site.id, 30);
    const emptySlots = Math.max(0, site.capacity - tenants.length);
    return {
      siteId: site.id, name: site.name, region: site.region, capacity: site.capacity, tenants,
      tenantCount: tenants.length, occupancyPct: site.capacity ? (tenants.length / site.capacity) * 100 : 0,
      monthlyRevenue, emptySlots, opportunityMonthly: emptySlots * avg,
      availability30d: sla.actualPct, downtimeHours30d: sla.downtimeHours,
      // Revenue put at risk by downtime: pro-rata fee × credit multiplier (see Settings).
      slaCreditExposure30d: (monthlyRevenue / 730) * mult * sla.downtimeHours,
    };
  });
  const totals = {
    sites: summary.length,
    tenants: summary.reduce((s, x) => s + x.tenantCount, 0),
    capacity: summary.reduce((s, x) => s + x.capacity, 0),
    monthlyRevenue: summary.reduce((s, x) => s + x.monthlyRevenue, 0),
    opportunityMonthly: summary.reduce((s, x) => s + x.opportunityMonthly, 0),
    slaCreditExposure30d: summary.reduce((s, x) => s + x.slaCreditExposure30d, 0),
  };
  totals.tenancyRatio = totals.sites ? totals.tenants / totals.sites : 0;
  totals.occupancyPct = totals.capacity ? (totals.tenants / totals.capacity) * 100 : 0;
  res.json({ avgContractValue: avg, totals, sites: summary });
});

router.get('/opportunities', requireAuth, (req, res) => {
  const avg = avgContract();
  const rows = db.all(`SELECT s.id, s.name, s.region, s.capacity, COUNT(t.id) AS n FROM sites s LEFT JOIN tenants t ON t.site_id = s.id GROUP BY s.id`);
  const opportunities = rows.map(r => {
    const sla = computeSla(r.id, 30);
    return {
      siteId: r.id, name: r.name, region: r.region, emptySlots: Math.max(0, r.capacity - r.n), occupancyPct: (r.n / r.capacity) * 100,
      estimatedMonthlyOpportunity: Math.max(0, r.capacity - r.n) * avg, availability30d: sla.actualPct,
      // A site that keeps going dark is hard to sell, so flag readiness.
      sellable: sla.actualPct >= 99,
    };
  }).filter(o => o.emptySlots > 0).sort((a, b) => b.estimatedMonthlyOpportunity - a.estimatedMonthlyOpportunity);
  res.json({ avgContractValue: avg, opportunities });
});

router.post('/:siteId/tenants', requireRole('admin'), (req, res) => {
  const site = db.get('SELECT * FROM sites WHERE id = ?', [req.params.siteId]);
  if (!site) throw new HttpError(404, 'Site not found');
  const name = str(req.body.name, 'Tenant name', { max: 120 });
  const value = num(req.body.contract_value_monthly ?? 0, 'Monthly contract value', { min: 0, max: 10000000 });
  const count = db.get('SELECT COUNT(*) AS c FROM tenants WHERE site_id = ?', [site.id]).c;
  if (count >= site.capacity) throw new HttpError(409, `Site is at capacity (${site.capacity} tenants)`);
  const r = db.run('INSERT INTO tenants (site_id, name, contract_value_monthly) VALUES (?, ?, ?)', [site.id, name, value]);
  audit(req.user.id, 'tenant.create', { siteId: site.id, name, value });
  res.status(201).json({ tenant: db.get('SELECT * FROM tenants WHERE id = ?', [r.lastInsertRowid]) });
});

router.delete('/:siteId/tenants/:tenantId', requireRole('admin'), (req, res) => {
  const r = db.run('DELETE FROM tenants WHERE id = ? AND site_id = ?', [Number(req.params.tenantId), req.params.siteId]);
  if (!r.changes) throw new HttpError(404, 'Tenant not found at this site');
  audit(req.user.id, 'tenant.delete', { siteId: req.params.siteId, tenantId: req.params.tenantId });
  res.json({ ok: true });
});

module.exports = router;
