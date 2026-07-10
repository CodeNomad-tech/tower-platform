'use strict';
/**
 * Fleet simulator — stands in for physical hardware across a network of
 * towers (this is the "closest functional alternative" documented in
 * docs/HARDWARE_SIMULATION.md; see that file for the real-hardware
 * replacement path). It publishes over the SAME MQTT topics and payload
 * schema a real device would use, so the backend and frontend cannot tell
 * the difference between this and a real fleet.
 *
 * Realism, not randomness:
 *  - Solar output follows an actual diurnal (sunrise/sunset) curve.
 *  - Fuel drains proportionally to generator runtime, not randomly.
 *  - Automatic power switching follows real priority logic (grid > solar > generator).
 *  - Occasional bounded anomaly events (theft, smoke, motion) are injected
 *    deliberately and rarely, to exercise the alert pipeline — documented
 *    here, not hidden.
 */

const { MqttClient } = require('../mqtt/client');
const { DEMO_SITES } = require('../db/seed');

const TICK_MS = 4000; // one simulated telemetry tick per site every 4s (~kiosk/demo pace)

function solarOutputWatts(hourFloat) {
  // Simple daylight bell curve: 0 before 6am/after 6pm, peak ~1000W at noon
  if (hourFloat < 6 || hourFloat > 18) return 0;
  const x = (hourFloat - 12) / 6; // -1..1
  return Math.max(0, 1000 * Math.cos((Math.PI / 2) * x));
}

function nowHourFloat() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

class SiteState {
  constructor(id) {
    this.id = id;
    this.fuelPct = 70 + Math.random() * 25;
    this.generatorOn = false;
    this.activeSource = 'grid';
    this.gridUp = true;
    this.tempC = 24 + Math.random() * 4;
    this.tickCount = 0; // resets to zero on each simulator (re)start
  }
}

async function startFleetSimulator({ mqttPort }) {
  const client = new MqttClient({ port: mqttPort, clientId: 'fleet-simulator' });
  await client.connect();

  const states = DEMO_SITES.map(s => new SiteState(s.id));

  for (const state of states) {
    // Stagger each site's ticks slightly so the demo doesn't look like one synchronized pulse
    const jitter = Math.floor(Math.random() * 1500);
    setTimeout(() => {
      tick(client, state); // fire once immediately so the dashboard has data right away
      setInterval(() => tick(client, state), TICK_MS);
    }, jitter);
  }

  return client;
}

function tick(client, state) {
  state.tickCount++;
  const hour = nowHourFloat();
  const solarW = solarOutputWatts(hour);

  // Occasionally simulate a brief grid outage (rare, bounded) to exercise auto-switching
  if (state.tickCount % 90 === 0) state.gridUp = !state.gridUp || Math.random() > 0.15;

  // Source priority: grid > solar (if enough output) > generator
  let source;
  if (state.gridUp) source = 'grid';
  else if (solarW > 300) source = 'solar';
  else source = 'generator';

  const wasGeneratorOn = state.generatorOn;
  state.generatorOn = source === 'generator';
  if (state.generatorOn && !wasGeneratorOn) {
    client.publish(`sites/${state.id}/generator`, JSON.stringify({ event: 'start' }));
  } else if (!state.generatorOn && wasGeneratorOn) {
    client.publish(`sites/${state.id}/generator`, JSON.stringify({ event: 'stop' }));
  }

  // Publish all three source readings (active flag marks which one is currently supplying)
  for (const src of ['grid', 'solar', 'generator']) {
    const active = src === source;
    let watts = 0;
    if (src === 'grid') watts = active ? 800 + Math.random() * 100 : 0;
    if (src === 'solar') watts = active ? solarW : solarW > 0 ? solarW * 0.1 : 0; // trickle-charging even when not primary
    if (src === 'generator') watts = active ? 750 + Math.random() * 80 : 0;
    client.publish(`sites/${state.id}/power`, JSON.stringify({
      source: src, active, voltage: active ? 220 + (Math.random() * 6 - 3) : 0, output_watts: Math.round(watts),
    }));
  }

  // Fuel drains only while generator runs; refuels occasionally (simulated service visit)
  if (state.generatorOn) {
    state.fuelPct = Math.max(0, state.fuelPct - 0.35); // ~drain rate per tick
  }
  if (state.fuelPct < 15 && state.tickCount % 200 === 0) {
    state.fuelPct = 95; // simulated refuel
  }
  // Rare injected anomaly: sudden fuel drop while generator is off (theft simulation)
  if (state.tickCount % 500 === 137) {
    state.fuelPct = Math.max(0, state.fuelPct - 20);
  }
  client.publish(`sites/${state.id}/fuel`, JSON.stringify({
    level_pct: Number(state.fuelPct.toFixed(1)), generator_on: state.generatorOn,
  }));

  // Environmental: temperature drifts with generator heat + time of day; rare smoke/motion events
  state.tempC += (state.generatorOn ? 0.15 : -0.05) + (Math.random() * 0.2 - 0.1);
  state.tempC = Math.max(18, Math.min(50, state.tempC));
  const smoke = state.tickCount % 700 === 313; // very rare, deliberate demo event
  const motion = Math.random() < 0.03;
  const doorOpen = Math.random() < 0.02;
  client.publish(`sites/${state.id}/env`, JSON.stringify({
    temperature_c: Number(state.tempC.toFixed(1)), smoke_detected: smoke, door_open: doorOpen, motion_detected: motion,
  }));
  if (motion) {
    client.publish(`sites/${state.id}/security`, JSON.stringify({
      event_type: 'motion', source: 'pir', confidence: 0.8 + Math.random() * 0.15,
    }));
  }

  client.publish(`sites/${state.id}/heartbeat`, JSON.stringify({ ts: Date.now() }));
}

module.exports = { startFleetSimulator, solarOutputWatts };
