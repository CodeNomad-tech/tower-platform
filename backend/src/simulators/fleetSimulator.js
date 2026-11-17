'use strict';
/**
 * Fleet simulator: stands in for tower hardware in demo mode.
 *
 * Each site is driven by the same power model used for history and
 * forecasting (engine/powerModel.js), in REAL TIME (not accelerated), under
 * its load-shedding profile. It publishes over MQTT using the exact topic and
 * payload contract a real remote-monitoring unit would use, so the backend
 * cannot tell it apart from hardware.
 *
 * It resumes from the last persisted state (fuel, battery, generator), so the
 * live stream continues seamlessly from the simulated 30-day history.
 *
 * `controls` lets an admin trigger demo scenarios (feeder outage, siphoning,
 * intrusion, smoke, fuel delivery) via /api/demo. Each is a physical change to
 * the simulated site, and the platform reacts through its normal pipeline.
 */

const config = require('../config');
const db = require('../db');
const { MqttClient } = require('../mqtt/client');
const { step, rng, localHour, solarShape } = require('../engine/powerModel');
const { PROFILES, scheduleSimulator } = require('../engine/gridModel');

class SimSite {
  constructor(row, rand) {
    this.id = row.site_id;
    this.a = { ...row };
    this.rand = rand;
    const fuel = db.get('SELECT level_pct FROM fuel_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [this.id]);
    const batt = db.get('SELECT soc_pct FROM battery_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [this.id]);
    const gen = db.get('SELECT event FROM generator_runtime_log WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [this.id]);
    const env = db.get('SELECT temperature_c FROM env_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [this.id]);
    this.st = {
      fuelL: fuel ? (fuel.level_pct / 100) * this.a.tank_l : this.a.tank_l * 0.7,
      socKwh: batt ? (batt.soc_pct / 100) * this.a.battery_kwh : this.a.battery_kwh,
      genOn: gen ? gen.event === 'start' : false,
    };
    this.tempC = env?.temperature_c ?? 26;
    this.grid = scheduleSimulator(PROFILES[this.a.grid_profile] || PROFILES.A, rand);
    this.forcedOutageUntil = 0;
    this.forcedGridUp = false;
    this.pending = [];   // one-shot events (smoke, intrusion)
    this.tick = 0;
    this.cloud = 0.6 + rand() * 0.4;
  }
}

const controls = {
  sites: new Map(),
  enabled: false,
  outage(siteId, hours = 6) { const s = this._s(siteId); s.forcedOutageUntil = Date.now() + hours * 3600000; s.forcedGridUp = false; return { siteId, gridForcedOffUntil: new Date(s.forcedOutageUntil).toISOString() }; },
  restoreGrid(siteId) { const s = this._s(siteId); s.forcedOutageUntil = 0; s.forcedGridUp = true; setTimeout(() => { s.forcedGridUp = false; }, 30 * 60000); return { siteId, grid: 'restored for 30 min' }; },
  siphon(siteId, litres) { const s = this._s(siteId); const taken = Math.min(s.st.fuelL, litres); s.st.fuelL -= taken; return { siteId, litresRemoved: Math.round(taken) }; },
  deliver(siteId, litres) { const s = this._s(siteId); const add = Math.min(litres, s.a.tank_l - s.st.fuelL); s.st.fuelL += add; return { siteId, litresAdded: Math.round(add) }; },
  intrusion(siteId) { this._s(siteId).pending.push('intrusion'); return { siteId, event: 'intrusion' }; },
  smoke(siteId) { this._s(siteId).pending.push('smoke'); return { siteId, event: 'smoke' }; },
  snapshot() {
    return [...this.sites.values()].map(s => ({
      siteId: s.id, fuelL: Math.round(s.st.fuelL), socPct: s.a.battery_kwh ? Math.round(s.st.socKwh / s.a.battery_kwh * 100) : null,
      genOn: s.st.genOn, forcedOutage: s.forcedOutageUntil > Date.now(),
    }));
  },
  _s(siteId) {
    const s = this.sites.get(siteId);
    if (!s) throw Object.assign(new Error('Site is not driven by the simulator'), { status: 404 });
    return s;
  },
};

async function startFleetSimulator({ mqttPort }) {
  const client = new MqttClient({ port: mqttPort, clientId: 'fleet-simulator' });
  await client.connect();
  const rand = rng(Date.now() & 0xffffffff);
  const rows = db.all('SELECT a.* FROM site_assets a JOIN sites s ON s.id = a.site_id WHERE s.simulated = 1');
  for (const row of rows) controls.sites.set(row.site_id, new SimSite(row, rand));
  controls.enabled = true;

  const dtH = config.SIM_TICK_MS / 3600000;
  const timers = [];
  for (const sim of controls.sites.values()) {
    const run = () => { try { tick(client, sim, dtH); } catch (e) { console.error('[simulator]', e.message); } };
    timers.push(setTimeout(() => { run(); timers.push(setInterval(run, config.SIM_TICK_MS)); }, Math.floor(rand() * 2000)));
  }
  return { client, stop: () => { timers.forEach(t => { clearTimeout(t); clearInterval(t); }); client.end(); controls.enabled = false; } };
}

function tick(client, sim, dtH) {
  const now = Date.now();
  const pub = (ch, obj) => client.publish(`sites/${sim.id}/${ch}`, JSON.stringify(obj));
  sim.tick++;
  if (sim.tick % 360 === 0) sim.cloud = 0.6 + sim.rand() * 0.4;

  const scheduledUp = sim.grid(now, dtH);
  const gridUp = sim.forcedGridUp || (scheduledUp && now >= sim.forcedOutageUntil);
  const solarKw = sim.a.solar_kw * solarShape(localHour(now)) * sim.cloud;
  const r = step(sim.st, sim.a, gridUp, solarKw, dtH);

  if (r.genStarted) pub('generator', { event: 'start' });
  if (r.genStopped) pub('generator', { event: 'stop' });

  const kw = { grid: r.gridKw, solar: r.solarKw, battery: r.batteryKw, generator: r.genKw };
  for (const s of ['grid', 'solar', 'battery', 'generator']) {
    const active = r.source === s;
    const voltage = s === 'grid' ? (gridUp ? 220 + (sim.rand() * 8 - 4) : 0) : s === 'battery' ? 48 + 4 * (sim.st.socKwh / Math.max(1, sim.a.battery_kwh)) : active ? 220 : 0;
    pub('power', { source: s, active, voltage: Math.round(voltage * 10) / 10, output_watts: Math.round(kw[s] * 1000) });
  }
  if (sim.a.battery_kwh > 0) pub('battery', { soc_pct: Math.round((sim.st.socKwh / sim.a.battery_kwh) * 1000) / 10 });
  if (sim.a.tank_l > 0) pub('fuel', { level_pct: Math.round((sim.st.fuelL / sim.a.tank_l) * 1000) / 10, generator_on: sim.st.genOn });

  if (sim.tick % 6 === 1 || sim.pending.length) {
    const h = localHour(now);
    const ambient = 21 + 9 * Math.max(0, Math.sin((Math.PI * (h - 8)) / 14));
    sim.tempC += ((ambient + (sim.st.genOn ? 6 : 0)) - sim.tempC) * 0.05 + (sim.rand() - 0.5) * 0.2;
    const smoke = sim.pending.includes('smoke');
    pub('env', { temperature_c: Math.round(sim.tempC * 10) / 10, smoke_detected: smoke, door_open: false, motion_detected: false });
  }
  if (sim.pending.includes('intrusion')) pub('security', { event_type: 'intrusion', source: 'camera', confidence: 0.93 });
  sim.pending = [];

  pub('heartbeat', { powered: !r.dark });
}

module.exports = { startFleetSimulator, controls };
