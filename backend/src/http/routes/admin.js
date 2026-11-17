'use strict';
/**
 * Settings (business assumptions), SLA targets, device keys, audit log,
 * demo scenario controls and public metadata.
 */
const crypto = require('node:crypto');
const db = require('../../db');
const config = require('../../config');
const settings = require('../../settings');
const { Router, HttpError, str, num } = require('../router');
const { requireAuth, requireRole, audit } = require('../../auth/auth');
const { sha256 } = require('../../auth/passwords');
const resilience = require('../../engine/resilience');
const ingest = require('../../mqtt/ingest');

const pkg = require('../../../package.json');

// ---------------- meta (public) ----------------
const meta = new Router();
meta.get('/', (req, res) => {
  const simulated = db.get('SELECT COUNT(*) AS n FROM sites WHERE simulated = 1').n;
  res.json({
    product: 'TowerIQ', version: pkg.version, demoMode: config.DEMO_MODE,
    dataNotice: simulated ? `Demonstration data: ${simulated} simulated sites with simulated telemetry and history. Not Infratel operational data.` : null,
    demoLogin: config.DEMO_MODE ? { email: config.DEMO_ADMIN_EMAIL } : null,
  });
});
meta.get('/health', (req, res) => res.json({ ok: true, ingest: ingest.stats, time: new Date().toISOString() }));

// ---------------- settings ----------------
const settingsRouter = new Router();
settingsRouter.get('/', requireAuth, (req, res) => res.json({ settings: settings.describe() }));
settingsRouter.put('/', requireRole('admin'), (req, res) => {
  const changed = {};
  for (const [k, v] of Object.entries(req.body)) changed[k] = settings.set(k, v);
  resilience.invalidate();
  audit(req.user.id, 'settings.update', changed);
  res.json({ settings: settings.describe() });
});

// Device pairing for phone camera nodes. The raw key is shown once; only its hash is stored.
settingsRouter.post('/device-keys', requireRole('admin'), (req, res) => {
  const label = str(req.body.label ?? 'Camera node', 'Label', { max: 60 });
  const key = crypto.randomBytes(18).toString('base64url');
  db.run('INSERT INTO device_keys (key_hash, label) VALUES (?, ?)', [sha256(key), label]);
  audit(req.user.id, 'device.create', { label });
  res.status(201).json({ key, label, note: 'Shown once. Open /camera-node?key=<key> on the device.' });
});
settingsRouter.get('/device-keys', requireRole('admin'), (req, res) => {
  res.json({ devices: db.all('SELECT substr(key_hash, 1, 8) AS id, label, created_at FROM device_keys ORDER BY created_at DESC') });
});
settingsRouter.get('/audit', requireRole('admin'), (req, res) => {
  res.json({ entries: db.all('SELECT a.id, a.action, a.detail, a.ts, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200') });
});

// ---------------- SLA targets ----------------
const sla = new Router();
sla.get('/', requireAuth, (req, res) => res.json({ thresholds: db.all('SELECT * FROM sla_thresholds ORDER BY site_id') }));
sla.put('/:siteId', requireRole('admin'), (req, res) => {
  if (!db.get('SELECT id FROM sites WHERE id = ?', [req.params.siteId])) throw new HttpError(404, 'Site not found');
  const target = num(req.body.target_uptime_pct, 'Target uptime %', { min: 90, max: 100 });
  db.run(`INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, ?) ON CONFLICT(site_id) DO UPDATE SET target_uptime_pct = excluded.target_uptime_pct`, [req.params.siteId, target]);
  audit(req.user.id, 'sla.target', { siteId: req.params.siteId, target });
  res.json({ threshold: db.get('SELECT * FROM sla_thresholds WHERE site_id = ?', [req.params.siteId]) });
});

// ---------------- demo scenario controls ----------------
const demo = new Router();
function sim() {
  if (!config.DEMO_MODE) throw new HttpError(404, 'Demo controls are disabled (DEMO_MODE=false)');
  const { controls } = require('../../simulators/fleetSimulator');
  if (!controls.enabled) throw new HttpError(409, 'Fleet simulator is not running');
  return controls;
}
demo.get('/status', requireAuth, (req, res) => res.json({ enabled: config.DEMO_MODE, sites: config.DEMO_MODE ? require('../../simulators/fleetSimulator').controls.snapshot() : [] }));
demo.post('/scenario', requireRole('admin'), (req, res) => {
  const c = sim();
  const siteId = str(req.body.siteId, 'Site', { max: 40 });
  const action = str(req.body.action, 'Action', { max: 20 });
  let result;
  switch (action) {
    case 'outage': result = c.outage(siteId, num(req.body.hours ?? 8, 'Hours', { min: 0.25, max: 72 })); break;
    case 'restore': result = c.restoreGrid(siteId); break;
    case 'siphon': result = c.siphon(siteId, num(req.body.litres ?? 120, 'Litres', { min: 1, max: 5000 })); break;
    case 'intrusion': result = c.intrusion(siteId); break;
    case 'smoke': result = c.smoke(siteId); break;
    default: throw new HttpError(400, 'Unknown scenario action');
  }
  resilience.invalidate();
  audit(req.user.id, `demo.${action}`, { siteId, ...result });
  res.json({ ok: true, result, note: 'Simulated event: the platform reacts through its normal telemetry pipeline within one tick.' });
});

module.exports = { meta, settingsRouter, sla, demo };
