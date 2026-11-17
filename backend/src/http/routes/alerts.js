'use strict';
const db = require('../../db');
const { Router, HttpError, str } = require('../router');
const { requireAuth, requireRole, audit } = require('../../auth/auth');

const router = new Router();
const STATUSES = new Set(['new', 'acknowledged', 'resolved', 'open']);
const SEVERITIES = new Set(['info', 'warning', 'critical']);

router.get('/', requireAuth, (req, res) => {
  const { status, siteId, severity } = req.query;
  let sql = `SELECT a.*, s.name AS site_name, ua.email AS acknowledged_by_email, ur.email AS resolved_by_email
               FROM alerts a JOIN sites s ON s.id = a.site_id
               LEFT JOIN users ua ON ua.id = a.acknowledged_by LEFT JOIN users ur ON ur.id = a.resolved_by WHERE 1=1`;
  const p = [];
  if (status) {
    if (!STATUSES.has(status)) throw new HttpError(400, 'Invalid status filter');
    if (status === 'open') sql += ` AND a.status != 'resolved'`; else { sql += ' AND a.status = ?'; p.push(status); }
  }
  if (severity) { if (!SEVERITIES.has(severity)) throw new HttpError(400, 'Invalid severity filter'); sql += ' AND a.severity = ?'; p.push(severity); }
  if (siteId) { sql += ' AND a.site_id = ?'; p.push(siteId); }
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  sql += ` ORDER BY CASE a.status WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, a.created_at DESC LIMIT ${limit}`;
  res.json({ alerts: db.all(sql, p) });
});

function getAlert(id) {
  const a = db.get('SELECT * FROM alerts WHERE id = ?', [Number(id)]);
  if (!a) throw new HttpError(404, 'Alert not found');
  return a;
}

router.post('/:id/acknowledge', requireRole('operator'), (req, res) => {
  const a = getAlert(req.params.id);
  if (a.status !== 'new') throw new HttpError(409, `Alert is already ${a.status}`);
  db.run(`UPDATE alerts SET status = 'acknowledged', acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ?`, [req.user.id, a.id]);
  audit(req.user.id, 'alert.acknowledge', { id: a.id });
  res.json({ alert: db.get('SELECT * FROM alerts WHERE id = ?', [a.id]) });
});

router.post('/:id/resolve', requireRole('operator'), (req, res) => {
  const a = getAlert(req.params.id);
  if (a.status === 'resolved') throw new HttpError(409, 'Alert is already resolved');
  const note = str(req.body.note, 'Resolution note', { max: 500, required: false });
  db.run(`UPDATE alerts SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ?, resolution_note = ?,
            acknowledged_at = COALESCE(acknowledged_at, datetime('now')), acknowledged_by = COALESCE(acknowledged_by, ?) WHERE id = ?`,
  [req.user.id, note, req.user.id, a.id]);
  audit(req.user.id, 'alert.resolve', { id: a.id, note });
  res.json({ alert: db.get('SELECT * FROM alerts WHERE id = ?', [a.id]) });
});

// Mean time to acknowledge / resolve, computed from real alarm timestamps.
router.get('/metrics/mttx', requireAuth, (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const rows = db.all(`SELECT type, created_at, acknowledged_at, resolved_at FROM alerts WHERE created_at >= datetime('now', ?)`, [`-${days} days`]);
  const ack = [], resolve = [];
  for (const r of rows) {
    const c = db.tsToMs(r.created_at);
    if (r.acknowledged_at) ack.push((db.tsToMs(r.acknowledged_at) - c) / 60000);
    if (r.resolved_at) resolve.push((db.tsToMs(r.resolved_at) - c) / 60000);
  }
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const counts = db.all(`SELECT severity, COUNT(*) AS n FROM alerts WHERE status != 'resolved' GROUP BY severity`);
  res.json({
    days, meanTimeToAcknowledgeMin: avg(ack), meanTimeToResolveMin: avg(resolve),
    sampleSize: { acknowledged: ack.length, resolved: resolve.length, total: rows.length },
    open: Object.fromEntries(counts.map(c => [c.severity, c.n])),
  });
});

module.exports = router;
