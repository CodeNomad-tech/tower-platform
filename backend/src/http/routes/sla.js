'use strict';
const db = require('../../db');
const { Router, HttpError } = require('../router');
const { requireAuth } = require('../../auth/auth');

const router = new Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ thresholds: db.all('SELECT * FROM sla_thresholds') });
});

router.put('/:siteId', requireAuth, (req, res) => {
  const { target_uptime_pct } = req.body;
  if (typeof target_uptime_pct !== 'number' || target_uptime_pct <= 0 || target_uptime_pct > 100) {
    throw new HttpError(400, 'target_uptime_pct must be a number between 0 and 100');
  }
  db.run(
    `INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, ?)
     ON CONFLICT(site_id) DO UPDATE SET target_uptime_pct = excluded.target_uptime_pct`,
    [req.params.siteId, target_uptime_pct]
  );
  res.json({ threshold: db.get('SELECT * FROM sla_thresholds WHERE site_id = ?', [req.params.siteId]) });
});

module.exports = router;
