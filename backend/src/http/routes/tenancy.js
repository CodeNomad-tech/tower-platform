'use strict';
const db = require('../../db');
const { Router, HttpError } = require('../router');
const { requireAuth } = require('../../auth/auth');

const router = new Router();

router.get('/', requireAuth, (req, res) => {
  const sites = db.all('SELECT id, name, capacity FROM sites');
  const summary = sites.map(site => {
    const tenants = db.all('SELECT * FROM tenants WHERE site_id = ?', [site.id]);
    const occupancyPct = site.capacity > 0 ? (tenants.length / site.capacity) * 100 : 0;
    const monthlyRevenue = tenants.reduce((s, t) => s + t.contract_value_monthly, 0);
    return { siteId: site.id, name: site.name, capacity: site.capacity, tenantCount: tenants.length, occupancyPct, monthlyRevenue };
  });
  res.json({ sites: summary });
});

router.get('/opportunities', requireAuth, (req, res) => {
  const sites = db.all('SELECT id, name, capacity FROM sites');
  // Average contract value across all tenants, used to estimate revenue opportunity for empty slots
  const allTenants = db.all('SELECT contract_value_monthly FROM tenants');
  const avgValue = allTenants.length
    ? allTenants.reduce((s, t) => s + t.contract_value_monthly, 0) / allTenants.length
    : 0;

  const opportunities = sites.map(site => {
    const tenantCount = db.get('SELECT COUNT(*) as c FROM tenants WHERE site_id = ?', [site.id]).c;
    const occupancyPct = site.capacity > 0 ? (tenantCount / site.capacity) * 100 : 0;
    const emptySlots = Math.max(0, site.capacity - tenantCount);
    const estimatedMonthlyOpportunity = emptySlots * avgValue;
    return { siteId: site.id, name: site.name, occupancyPct, emptySlots, estimatedMonthlyOpportunity };
  })
    .filter(o => o.emptySlots > 0)
    .sort((a, b) => b.estimatedMonthlyOpportunity - a.estimatedMonthlyOpportunity);

  res.json({ avgContractValue: avgValue, opportunities });
});

router.post('/:siteId/tenants', requireAuth, (req, res) => {
  const { name, contract_value_monthly } = req.body;
  if (!name) throw new HttpError(400, 'Tenant name is required');
  const site = db.get('SELECT * FROM sites WHERE id = ?', [req.params.siteId]);
  if (!site) throw new HttpError(404, 'Site not found');
  const result = db.run(
    'INSERT INTO tenants (site_id, name, contract_value_monthly) VALUES (?, ?, ?)',
    [req.params.siteId, name, contract_value_monthly || 0]
  );
  res.status(201).json({ tenant: db.get('SELECT * FROM tenants WHERE id = ?', [result.lastInsertRowid]) });
});

router.delete('/:siteId/tenants/:tenantId', requireAuth, (req, res) => {
  db.run('DELETE FROM tenants WHERE id = ? AND site_id = ?', [req.params.tenantId, req.params.siteId]);
  res.json({ ok: true });
});

module.exports = router;
