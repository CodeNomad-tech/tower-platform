'use strict';
const db = require('../../db');
const { Router, HttpError } = require('../router');
const { requireAuth } = require('../../auth/auth');

const router = new Router();

router.get('/', requireAuth, (req, res) => {
  const { status, siteId } = req.query;
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (siteId) { sql += ' AND site_id = ?'; params.push(siteId); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json({ alerts: db.all(sql, params) });
});

router.post('/:id/acknowledge', requireAuth, (req, res) => {
  const alert = db.get('SELECT * FROM alerts WHERE id = ?', [req.params.id]);
  if (!alert) throw new HttpError(404, 'Alert not found');
  db.run(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ?`,
    [req.user.id, req.params.id]
  );
  res.json({ alert: db.get('SELECT * FROM alerts WHERE id = ?', [req.params.id]) });
});

router.post('/:id/resolve', requireAuth, (req, res) => {
  const alert = db.get('SELECT * FROM alerts WHERE id = ?', [req.params.id]);
  if (!alert) throw new HttpError(404, 'Alert not found');
  db.run(
    `UPDATE alerts SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ? WHERE id = ?`,
    [req.user.id, req.params.id]
  );
  res.json({ alert: db.get('SELECT * FROM alerts WHERE id = ?', [req.params.id]) });
});

// Ops metric: mean time to acknowledge / resolve, computed from real timestamps
router.get('/metrics/mttx', requireAuth, (req, res) => {
  const rows = db.all(
    `SELECT created_at, acknowledged_at, resolved_at FROM alerts
     WHERE acknowledged_at IS NOT NULL OR resolved_at IS NOT NULL`
  );
  let ackTotal = 0, ackCount = 0, resolveTotal = 0, resolveCount = 0;
  for (const r of rows) {
    if (r.acknowledged_at) {
      ackTotal += new Date(r.acknowledged_at) - new Date(r.created_at);
      ackCount++;
    }
    if (r.resolved_at) {
      resolveTotal += new Date(r.resolved_at) - new Date(r.created_at);
      resolveCount++;
    }
  }
  res.json({
    meanTimeToAcknowledgeMin: ackCount ? (ackTotal / ackCount / 60000).toFixed(1) : null,
    meanTimeToResolveMin: resolveCount ? (resolveTotal / resolveCount / 60000).toFixed(1) : null,
    sampleSize: { acknowledged: ackCount, resolved: resolveCount },
  });
});

module.exports = router;
