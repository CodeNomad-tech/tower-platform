'use strict';
/**
 * Ingest service: the bridge from devices (MQTT) to the application
 * (SQLite + rule engine + WebSocket). Every device (Wokwi ESP32, phone
 * camera node, fleet simulator, future real RMS hardware) uses the same
 * topic contract (docs/API.md). Payloads are validated; messages for
 * unknown sites or with malformed values are dropped and counted.
 *
 *   sites/{siteId}/heartbeat   { powered?: bool }      powered=false → site DOWN (no power)
 *   sites/{siteId}/power       { source: grid|solar|battery|generator, active, voltage, output_watts }
 *   sites/{siteId}/battery     { soc_pct, voltage? }
 *   sites/{siteId}/fuel        { level_pct, generator_on }
 *   sites/{siteId}/generator   { event: start|stop }
 *   sites/{siteId}/env         { temperature_c, smoke_detected, door_open, motion_detected }
 *   sites/{siteId}/security    { event_type: motion|intrusion|unauthorized_access, source, confidence }
 */

const db = require('../db');
const ruleEngine = require('../engine/ruleEngine');

const SOURCES = new Set(['grid', 'solar', 'battery', 'generator']);
const stats = { accepted: 0, rejected: 0, lastRejectReason: null };

let siteIds = new Set();
let siteIdsLoadedAt = 0;
function siteExists(id) {
  if (siteIds.has(id)) return true;
  if (Date.now() - siteIdsLoadedAt > 5000) {
    siteIds = new Set(db.all('SELECT id FROM sites').map(r => r.id));
    siteIdsLoadedAt = Date.now();
  }
  return siteIds.has(id);
}

const lastActiveSource = new Map();
function getLastActive(siteId) {
  if (!lastActiveSource.has(siteId)) {
    const sw = db.get('SELECT to_source FROM power_switch_events WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [siteId]);
    const rd = db.get('SELECT source FROM power_readings WHERE site_id = ? AND active = 1 ORDER BY ts DESC, id DESC LIMIT 1', [siteId]);
    lastActiveSource.set(siteId, sw ? sw.to_source : rd ? rd.source : null);
  }
  return lastActiveSource.get(siteId);
}
function recordSwitch(siteId, to, reason) {
  const from = getLastActive(siteId);
  if (from === to) return null;
  lastActiveSource.set(siteId, to);
  if (from == null) return null;
  db.run('INSERT INTO power_switch_events (site_id, from_source, to_source, reason) VALUES (?, ?, ?, ?)', [siteId, from, to, reason]);
  return { from, to };
}

const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
function reject(reason) { stats.rejected++; stats.lastRejectReason = reason; }

function setStatus(siteId, status) {
  const cur = db.get('SELECT status FROM sites WHERE id = ?', [siteId])?.status;
  if (cur === status) return false;
  db.run('UPDATE sites SET status = ? WHERE id = ?', [status, siteId]);
  db.run('INSERT INTO status_log (site_id, status) VALUES (?, ?)', [siteId, status]);
  if (cur === 'offline') ruleEngine.autoResolve(siteId, 'comms_lost', 'Auto-resolved: telemetry resumed');
  return true;
}

/** Processes one message. Returns the list of events to broadcast. Exported for tests. */
function handleMessage(siteId, channel, payload) {
  const out = [];
  const pushAlerts = (alerts) => { for (const a of alerts) out.push({ channel: 'alert', siteId, alert: a }); };
  if (!siteExists(siteId)) return reject(`unknown site ${siteId}`), out;
  if (!payload || typeof payload !== 'object') return reject('payload not an object'), out;

  switch (channel) {
    case 'heartbeat': {
      db.run(`UPDATE sites SET last_heartbeat = datetime('now') WHERE id = ?`, [siteId]);
      const powered = payload.powered !== false;
      if (setStatus(siteId, powered ? 'online' : 'down')) {
        pushAlerts(ruleEngine.evaluatePowerState(siteId, powered));
        out.push({ channel: 'status', siteId, status: powered ? 'online' : 'down' });
      }
      if (!powered) {
        const sw = recordSwitch(siteId, 'none', 'all sources exhausted');
        if (sw) out.push({ channel: 'switch', siteId, ...sw });
      }
      out.push({ channel: 'heartbeat', siteId, powered });
      break;
    }
    case 'power': {
      if (!SOURCES.has(payload.source)) return reject('bad power.source'), out;
      const watts = finite(payload.output_watts, 0, 1e6) ? payload.output_watts : null;
      const volts = finite(payload.voltage, 0, 1000) ? payload.voltage : null;
      db.run('INSERT INTO power_readings (site_id, source, active, voltage, output_watts) VALUES (?, ?, ?, ?, ?)',
        [siteId, payload.source, payload.active ? 1 : 0, volts, watts]);
      if (payload.active) {
        const sw = recordSwitch(siteId, payload.source, 'automatic');
        if (sw) out.push({ channel: 'switch', siteId, ...sw });
      }
      out.push({ channel: 'power', siteId, payload: { source: payload.source, active: !!payload.active, output_watts: watts } });
      break;
    }
    case 'battery': {
      if (!finite(payload.soc_pct, 0, 100)) return reject('bad battery.soc_pct'), out;
      db.run('INSERT INTO battery_readings (site_id, soc_pct, voltage) VALUES (?, ?, ?)', [siteId, payload.soc_pct, finite(payload.voltage, 0, 1000) ? payload.voltage : null]);
      out.push({ channel: 'battery', siteId, payload: { soc_pct: payload.soc_pct } });
      break;
    }
    case 'fuel': {
      if (!finite(payload.level_pct, 0, 100)) return reject('bad fuel.level_pct'), out;
      const reading = { level_pct: payload.level_pct, generator_on: payload.generator_on ? 1 : 0 };
      db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on) VALUES (?, ?, ?)', [siteId, reading.level_pct, reading.generator_on]);
      pushAlerts(ruleEngine.evaluateFuel(siteId, reading));
      out.push({ channel: 'fuel', siteId, payload: reading });
      break;
    }
    case 'generator': {
      if (!['start', 'stop'].includes(payload.event)) return reject('bad generator.event'), out;
      db.run('INSERT INTO generator_runtime_log (site_id, event) VALUES (?, ?)', [siteId, payload.event]);
      out.push({ channel: 'generator', siteId, payload: { event: payload.event } });
      break;
    }
    case 'env': {
      const reading = {
        temperature_c: finite(payload.temperature_c, -40, 120) ? payload.temperature_c : null,
        smoke_detected: !!payload.smoke_detected, door_open: !!payload.door_open, motion_detected: !!payload.motion_detected,
      };
      db.run('INSERT INTO env_readings (site_id, temperature_c, smoke_detected, door_open, motion_detected) VALUES (?, ?, ?, ?, ?)',
        [siteId, reading.temperature_c, reading.smoke_detected ? 1 : 0, reading.door_open ? 1 : 0, reading.motion_detected ? 1 : 0]);
      pushAlerts(ruleEngine.evaluateEnv(siteId, reading));
      out.push({ channel: 'env', siteId, payload: reading });
      break;
    }
    case 'security': {
      if (!ruleEngine.SECURITY_TYPES.has(payload.event_type)) return reject('bad security.event_type'), out;
      const source = typeof payload.source === 'string' ? payload.source.slice(0, 40) : 'unknown';
      const confidence = finite(payload.confidence, 0, 1) ? payload.confidence : null;
      const ev = { event_type: payload.event_type, source, confidence };
      db.run('INSERT INTO security_events (site_id, event_type, source, confidence) VALUES (?, ?, ?, ?)', [siteId, ev.event_type, source, confidence]);
      pushAlerts(ruleEngine.evaluateSecurity(siteId, ev));
      out.push({ channel: 'security', siteId, payload: ev });
      break;
    }
    default:
      return reject(`unknown channel ${channel}`), out;
  }
  stats.accepted++;
  return out;
}

function startIngest(mqttClient, wsHub) {
  for (const c of ['heartbeat', 'power', 'battery', 'fuel', 'generator', 'env', 'security']) mqttClient.subscribe(`sites/+/${c}`);
  mqttClient.on('message', (topic, buf) => {
    const parts = topic.split('/');
    if (parts[0] !== 'sites' || parts.length !== 3) return;
    let payload;
    try { payload = JSON.parse(buf.toString('utf8')); } catch { return reject('malformed JSON'); }
    try {
      for (const ev of handleMessage(parts[1], parts[2], payload)) wsHub.broadcast(ev);
    } catch (e) {
      reject(e.message);
      console.error(`[ingest] error processing ${topic}:`, e.message);
    }
  });
}

/**
 * Adapter for the alternative hardware firmware topic scheme
 * (infratel/tower/{TWR-xxx}/telemetry|events|status). It translates into the
 * canonical channels above so all rules apply identically.
 */
const TOWER_TO_SITE = { 'TWR-001': 'LSK-001', 'TWR-002': 'CPB-002', 'TWR-003': 'SOU-001', 'TWR-004': 'CPB-007' };

function startHardwareIngest(mqttClient, wsHub) {
  for (const c of ['telemetry', 'events', 'status']) mqttClient.subscribe(`infratel/tower/+/${c}`);
  mqttClient.on('message', (topic, buf) => {
    const parts = topic.split('/');
    if (parts[0] !== 'infratel' || parts.length !== 4) return;
    const siteId = TOWER_TO_SITE[parts[2]];
    if (!siteId) return reject(`unmapped tower ${parts[2]}`);
    let p;
    try { p = JSON.parse(buf.toString('utf8')); } catch { return reject('malformed JSON'); }
    const emit = (ch, pl) => { for (const ev of handleMessage(siteId, ch, pl)) wsHub.broadcast(ev); };
    try {
      if (parts[3] === 'status') emit('heartbeat', { powered: p.status !== 'down' });
      if (parts[3] === 'telemetry') {
        emit('heartbeat', {});
        if (p.power && SOURCES.has(p.power.active_source)) emit('power', { source: p.power.active_source, active: true, voltage: Number(p.power.grid_voltage) || null });
        if (p.fuel) emit('fuel', { level_pct: Number(p.fuel.level_percent ?? p.fuel.level_pct), generator_on: !!p.power?.generator_running });
        if (p.environment) emit('env', { temperature_c: Number(p.environment.temperature_c), smoke_detected: !!p.environment.smoke_detected });
      }
      if (parts[3] === 'events') {
        if (['motion_detected', 'intrusion', 'unauthorized_access'].includes(p.event_type)) emit('security', { event_type: p.event_type === 'motion_detected' ? 'motion' : p.event_type, source: 'hardware_sensor', confidence: 0.95 });
        if (p.event_type === 'smoke_detected') emit('env', { smoke_detected: true });
      }
    } catch (e) { reject(e.message); }
  });
}

module.exports = { startIngest, startHardwareIngest, handleMessage, stats };
