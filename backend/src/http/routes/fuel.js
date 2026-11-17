'use strict';
const db = require('../../db');
const config = require('../../config');
const { Router, HttpError, str, num } = require('../router');
const { requireAuth, requireRole, audit } = require('../../auth/auth');
const { fleetIntegrity, reconcileSite } = require('../../engine/fuelIntegrity');
const resilience = require('../../engine/resilience');

const router = new Router();

router.get('/integrity', requireAuth, (req, res) => {
  const days = num(req.query.days ?? 30, 'days', { min: 1, max: 365 });
  res.json(fleetIntegrity(days));
});

router.get('/integrity/:siteId', requireAuth, (req, res) => {
  const r = reconcileSite(req.params.siteId, num(req.query.days ?? 30, 'days', { min: 1, max: 365 }));
  if (!r) throw new HttpError(404, 'No generator/fuel data for this site');
  res.json(r);
});

router.get('/deliveries', requireAuth, (req, res) => {
  const p = [];
  let sql = 'SELECT d.*, s.name AS site_name, u.email AS recorded_by_email FROM fuel_deliveries d JOIN sites s ON s.id = d.site_id LEFT JOIN users u ON u.id = d.recorded_by';
  if (req.query.siteId) { sql += ' WHERE d.site_id = ?'; p.push(req.query.siteId); }
  res.json({ deliveries: db.all(sql + ' ORDER BY d.ts DESC LIMIT 200', p) });
});

// Records a delivery note. In demo mode the simulated site physically receives the fuel too.
router.post('/deliveries', requireRole('operator'), (req, res) => {
  const siteId = str(req.body.siteId, 'Site', { max: 40 });
  const assets = db.get('SELECT tank_l FROM site_assets WHERE site_id = ?', [siteId]);
  if (!assets) throw new HttpError(404, 'Site not found');
  const litres = num(req.body.litres, 'Litres', { min: 1, max: assets.tank_l || 20000 });
  const supplier = str(req.body.supplier, 'Supplier', { max: 120, required: false });
  const reference = str(req.body.reference, 'Delivery note reference', { max: 60, required: false });
  const r = db.run('INSERT INTO fuel_deliveries (site_id, litres, supplier, reference, recorded_by) VALUES (?, ?, ?, ?, ?)', [siteId, litres, supplier, reference, req.user.id]);
  let simulated = null;
  if (config.DEMO_MODE) {
    const { controls } = require('../../simulators/fleetSimulator');
    if (controls.enabled && controls.sites.has(siteId)) simulated = controls.deliver(siteId, litres);
  }
  resilience.invalidate();
  audit(req.user.id, 'fuel.delivery', { siteId, litres, reference });
  res.status(201).json({ delivery: db.get('SELECT * FROM fuel_deliveries WHERE id = ?', [r.lastInsertRowid]), simulated });
});

module.exports = router;
