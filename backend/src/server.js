'use strict';
/**
 * TowerIQ server: one process, zero runtime dependencies.
 * HTTP API + static console + WebSocket live feed + embedded MQTT broker +
 * ingest + background jobs (+ fleet simulator in demo mode).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const db = require('./db');
const { Router, attachHelpers, sendError } = require('./http/router');
const { WsHub } = require('./ws/hub');
const { MqttBroker } = require('./mqtt/broker');
const { MqttClient } = require('./mqtt/client');
const { startIngest, startHardwareIngest } = require('./mqtt/ingest');
const ruleEngine = require('./engine/ruleEngine');
const predictiveEngine = require('./engine/predictiveEngine');
const { recordSlaBreach } = require('./engine/slaEngine');
const resilience = require('./engine/resilience');
const auth = require('./auth/auth');
const { sha256 } = require('./auth/passwords');
const admin = require('./http/routes/admin');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const CAMERA_DIR = path.resolve(__dirname, '../../hardware-simulation/camera-node');

const api = new Router();
api.use('/auth', auth.router);
api.use('/meta', admin.meta);
api.use('/sites', require('./http/routes/sites'));
api.use('/alerts', require('./http/routes/alerts'));
api.use('/tenancy', require('./http/routes/tenancy'));
api.use('/reports', require('./http/routes/reports'));
api.use('/resilience', require('./http/routes/resilience'));
api.use('/fuel', require('./http/routes/fuel'));
api.use('/settings', admin.settingsRouter);
api.use('/sla', admin.sla);
api.use('/demo', admin.demo);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function sendFile(res, file, cache = false) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache ? 'public, max-age=300' : 'no-cache' });
    res.end(data);
  });
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (p === '/camera-node' || p === '/camera-node/') return sendFile(res, path.join(CAMERA_DIR, 'index.html'));
  if (p.startsWith('/camera-node/')) {
    const f = path.resolve(CAMERA_DIR, '.' + p.slice('/camera-node'.length));
    if (!f.startsWith(CAMERA_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
    return sendFile(res, f);
  }
  if (p === '/') p = '/index.html';
  const full = path.resolve(FRONTEND_DIR, '.' + p);
  if (!full.startsWith(FRONTEND_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return sendFile(res, path.join(FRONTEND_DIR, 'index.html')); // SPA fallback
    sendFile(res, full);
  });
}

function authenticateWs(req, url) {
  const token = url.searchParams.get('token');
  if (token) {
    const user = auth.userForToken(token);
    return user ? { kind: 'user', user } : null;
  }
  const key = url.searchParams.get('device');
  if (key && key.length < 100 && db.get('SELECT label FROM device_keys WHERE key_hash = ?', [sha256(key)])) return { kind: 'device', key };
  return null;
}

async function main({ log = console.log } = {}) {
  require('./db/seed').seed({ log });

  const broker = new MqttBroker({ port: config.MQTT_PORT });
  await broker.listen();
  log(`[mqtt] broker listening on :${config.MQTT_PORT}`);

  const wsHub = new WsHub({ authenticate: authenticateWs });
  const ingestClient = new MqttClient({ port: config.MQTT_PORT, clientId: 'ingest-service' });
  await ingestClient.connect();
  startIngest(ingestClient, wsHub);
  startHardwareIngest(ingestClient, wsHub);

  // Field devices (phone camera nodes) publish detections over the WebSocket;
  // they are re-published onto MQTT so they follow the identical pipeline.
  wsHub.on('connection', (socket, id) => {
    if (id.kind === 'device') wsHub.send(socket, { type: 'hello', sites: db.all('SELECT id, name FROM sites ORDER BY id') });
  });
  wsHub.on('message', (socket, text, id) => {
    if (!id || id.kind !== 'device') return; // console clients are receive-only
    let msg; try { msg = JSON.parse(text); } catch { return; }
    if (msg.type !== 'camera-event' || typeof msg.siteId !== 'string' || !ruleEngine.SECURITY_TYPES.has(msg.event_type)) return;
    ingestClient.publish(`sites/${msg.siteId}/security`, JSON.stringify({ event_type: msg.event_type, source: 'camera', confidence: Number(msg.confidence) || null }));
  });

  const server = http.createServer((req, res) => {
    attachHelpers(res);
    securityHeaders(res);
    try {
      if (req.url.startsWith('/api/')) { req.url = req.url.slice(4); res.setHeader('Cache-Control', 'no-store'); api.handle(req, res); }
      else serveStatic(req, res);
    } catch (e) { sendError(res, e); }
  });
  server.on('upgrade', (req, socket) => {
    if (req.url.startsWith('/ws')) wsHub.handleUpgrade(req, socket); else socket.destroy();
  });
  await new Promise((r) => server.listen(config.HTTP_PORT, r));
  log(`[http] TowerIQ listening on http://localhost:${config.HTTP_PORT}  (demo mode: ${config.DEMO_MODE})`);

  const timers = [];
  timers.push(setInterval(() => {
    for (const a of ruleEngine.checkOfflineSites()) wsHub.broadcast({ channel: 'alert', siteId: a.site_id, alert: a });
  }, 30 * 1000));
  const slowJobs = () => {
    for (const s of db.all('SELECT id FROM sites')) {
      const r = recordSlaBreach(s.id, 30);
      if (r.alert) wsHub.broadcast({ channel: 'alert', siteId: s.id, alert: r.alert });
      for (const f of predictiveEngine.persistFlags(s.id)) wsHub.broadcast({ channel: 'maintenance', siteId: s.id, flag: f });
    }
    db.run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
  };
  timers.push(setInterval(slowJobs, 5 * 60 * 1000));
  setTimeout(slowJobs, 3000).unref?.();
  // Forecasts are cached briefly; nudge clients to refresh them periodically.
  timers.push(setInterval(() => { resilience.invalidate(); wsHub.broadcast({ channel: 'forecast' }); }, 60 * 1000));

  let simulator = null;
  if (config.RUN_SIMULATOR) {
    const { startFleetSimulator } = require('./simulators/fleetSimulator');
    simulator = await startFleetSimulator({ mqttPort: config.MQTT_PORT });
    log('[simulator] fleet simulator running (SIMULATED telemetry)');
  }

  async function stop() {
    timers.forEach(clearInterval);
    simulator?.stop();
    ingestClient.end();
    wsHub.closeAll();
    await new Promise((r) => server.close(r));
    await broker.close();
  }
  return { server, broker, wsHub, stop };
}

if (require.main === module) {
  main().then(({ stop }) => {
    const shutdown = () => { console.log('\n[server] shutting down'); stop().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((e) => { console.error('Fatal startup error:', e); process.exit(1); });
}

module.exports = { main };
