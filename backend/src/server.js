'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { Router, attachHelpers } = require('./http/router');
const { WsHub } = require('./ws/hub');
const { MqttBroker } = require('./mqtt/broker');
const { MqttClient } = require('./mqtt/client');
const { startIngest } = require('./mqtt/ingest');
const ruleEngine = require('./engine/ruleEngine');
const predictiveEngine = require('./engine/predictiveEngine');
const { evaluateSla } = require('./engine/slaEngine');
const db = require('./db');

const authRoutes = require('./auth/auth').router;
const sitesRoutes = require('./http/routes/sites');
const alertsRoutes = require('./http/routes/alerts');
const tenancyRoutes = require('./http/routes/tenancy');
const reportsRoutes = require('./http/routes/reports');
const slaRoutes = require('./http/routes/sla');

const HTTP_PORT = Number(process.env.PORT) || 3000;
const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;
const FRONTEND_DIR = path.join(__dirname, '../../frontend');

// --- API router -------------------------------------------------------
const api = new Router();
api.use('/auth', authRoutes);
api.use('/sites', sitesRoutes);
api.use('/alerts', alertsRoutes);
api.use('/tenancy', tenancyRoutes);
api.use('/reports', reportsRoutes);
api.use('/sla', slaRoutes);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';

  // The phone camera node lives outside the frontend/ dir (it's part of
  // hardware-simulation/), but needs to be same-origin with the backend
  // so its WebSocket connection isn't blocked by browser CORS-for-WS rules.
  if (filePath === '/camera-node') {
    const camPath = path.join(__dirname, '../../hardware-simulation/camera-node/index.html');
    fs.readFile(camPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  const fullPath = path.join(FRONTEND_DIR, filePath);
  if (!fullPath.startsWith(FRONTEND_DIR)) { res.writeHead(403); res.end(); return; }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // SPA fallback for client-side routes
      fs.readFile(path.join(FRONTEND_DIR, 'index.html'), (err2, indexData) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function main() {
  require('./db/seed').seed();

  // --- MQTT broker (device <-> server) ---
  const broker = new MqttBroker({ port: MQTT_PORT });
  await broker.listen();
  console.log(`[mqtt] broker listening on :${MQTT_PORT}`);

  const wsHub = new WsHub();

  const ingestClient = new MqttClient({ port: MQTT_PORT, clientId: 'ingest-service' });
  await ingestClient.connect();
  startIngest(ingestClient, wsHub);
  console.log('[ingest] subscribed to telemetry topics');

  // --- Inbound WebSocket messages (browser camera nodes can't speak raw
  // MQTT/TCP, so they publish detection events over the same WebSocket
  // connection used for live dashboard updates; we re-publish them onto
  // the MQTT bus so they go through the identical ingest/rule-engine path
  // as every other device). ---
  wsHub.on('message', (socket, text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.type === 'camera-event' && msg.siteId && msg.event_type) {
      ingestClient.publish(`sites/${msg.siteId}/security`, JSON.stringify({
        event_type: msg.event_type,
        source: 'camera',
        confidence: msg.confidence ?? null,
      }));
    }
  });

  // --- HTTP + WS server ---
  const server = http.createServer((req, res) => {
    attachHelpers(res);
    if (req.url.startsWith('/api/')) {
      req.url = req.url.slice(4);
      api.handle(req, res);
    } else {
      serveStatic(req, res);
    }
  });
  server.on('upgrade', (req, socket) => {
    if (req.url === '/ws') wsHub.handleUpgrade(req, socket);
    else socket.destroy();
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[http] Smart Tower Platform listening on http://localhost:${HTTP_PORT}`);
  });

  // --- Background jobs ---
  setInterval(() => {
    const offlineAlerts = ruleEngine.checkOfflineSites();
    for (const a of offlineAlerts) wsHub.broadcast({ channel: 'alert', siteId: a.site_id, alert: a });
  }, 30 * 1000);

  setInterval(() => {
    const sites = db.all('SELECT id FROM sites');
    for (const s of sites) {
      const result = evaluateSla(s.id, 30);
      if (result.breached) wsHub.broadcast({ channel: 'sla', siteId: s.id, result });
      const gen = predictiveEngine.evaluateGeneratorRuntimeTrend(s.id);
      const fuel = predictiveEngine.evaluateFuelEfficiencyTrend(s.id);
      if (gen) wsHub.broadcast({ channel: 'maintenance', siteId: s.id, flag: gen });
      if (fuel) wsHub.broadcast({ channel: 'maintenance', siteId: s.id, flag: fuel });
    }
  }, 5 * 60 * 1000);

  // --- Optional in-process fleet simulator ---
  if (process.env.RUN_SIMULATOR !== 'false') {
    const { startFleetSimulator } = require('./simulators/fleetSimulator');
    await startFleetSimulator({ mqttPort: MQTT_PORT });
    console.log('[simulator] fleet simulator running');
  }

  return { server, broker, wsHub };
}

if (require.main === module) {
  main().catch((e) => { console.error('Fatal startup error:', e); process.exit(1); });
}

module.exports = { main };
