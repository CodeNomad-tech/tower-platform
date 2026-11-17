'use strict';
// Unit tests for the engines, against an in-memory database (no server, no simulator).
process.env.DB_PATH = ':memory:';
process.env.DEMO_MODE = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { step, solarShape, localHour } = require('../src/engine/powerModel');
const { scheduledOff, PROFILES } = require('../src/engine/gridModel');
const ruleEngine = require('../src/engine/ruleEngine');
const sla = require('../src/engine/slaEngine');
const predictive = require('../src/engine/predictiveEngine');
const { reconcileSite } = require('../src/engine/fuelIntegrity');
const resilience = require('../src/engine/resilience');

const ts = (msAgo) => db.toSqliteTs(Date.now() - msAgo);
const H = 3600000;

function makeSite(id, assets = {}) {
  db.run('INSERT INTO sites (id, name, status, capacity) VALUES (?, ?, ?, 4)', [id, id, 'online']);
  db.run('INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, 99.5)', [id]);
  const a = { load_kw: 2, battery_kwh: 10, solar_kw: 0, tank_l: 1000, gen_kw: 10, gen_burn_lph: 2, grid_profile: 'A', refuel_lead_h: 24, ...assets };
  db.run(`INSERT INTO site_assets (site_id, load_kw, battery_kwh, solar_kw, tank_l, gen_kw, gen_burn_lph, grid_profile, refuel_lead_h) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, a.load_kw, a.battery_kwh, a.solar_kw, a.tank_l, a.gen_kw, a.gen_burn_lph, a.grid_profile, a.refuel_lead_h]);
  return a;
}

// ---------------------------------------------------------------- power model
test('power model: grid up serves load and charges battery; generator off', () => {
  const a = { load_kw: 2, battery_kwh: 10, solar_kw: 0, gen_kw: 10, gen_burn_lph: 2 };
  const st = { fuelL: 100, socKwh: 5, genOn: true };
  const r = step(st, a, true, 0, 0.25);
  assert.equal(r.source, 'grid');
  assert.equal(st.genOn, false);
  assert.ok(st.socKwh > 5);
  assert.equal(r.burnL, 0);
});

test('power model: grid down → battery, then generator at 30% SoC, burning nameplate litres', () => {
  const a = { load_kw: 2, battery_kwh: 10, solar_kw: 0, gen_kw: 10, gen_burn_lph: 2 };
  const st = { fuelL: 100, socKwh: 10, genOn: false };
  let r = step(st, a, false, 0, 0.25);
  assert.equal(r.source, 'battery');
  assert.ok(Math.abs(st.socKwh - 9.5) < 1e-9);
  st.socKwh = 3; // at start threshold
  r = step(st, a, false, 0, 0.25);
  assert.equal(r.source, 'generator');
  assert.ok(Math.abs(r.burnL - 0.5) < 1e-9);
  assert.ok(Math.abs(st.fuelL - 99.5) < 1e-9);
});

test('power model: no fuel and empty battery → DARK', () => {
  const a = { load_kw: 2, battery_kwh: 5, solar_kw: 0, gen_kw: 10, gen_burn_lph: 2 };
  const st = { fuelL: 0, socKwh: 0.1, genOn: false };
  const r = step(st, a, false, 0, 0.25);
  assert.equal(r.dark, true);
  assert.equal(r.source, 'none');
});

test('power model: battery-only site goes dark exactly when energy runs out', () => {
  const a = { load_kw: 2, battery_kwh: 4, solar_kw: 0, gen_kw: 0, gen_burn_lph: 0 };
  const st = { fuelL: 0, socKwh: 4, genOn: false };
  let darkAt = null;
  for (let i = 0; i < 20 && darkAt == null; i++) if (step(st, a, false, 0, 0.25).dark) darkAt = i * 0.25;
  assert.equal(darkAt, 2); // 4 kWh / 2 kW = 2 h
});

test('solar shape is zero at night and peaks at local noon', () => {
  assert.equal(solarShape(3), 0);
  assert.equal(solarShape(21), 0);
  assert.ok(Math.abs(solarShape(12) - 1) < 1e-9);
});

test('load-shedding schedule removes the configured hours per day', () => {
  const day0 = Date.UTC(2026, 0, 10, 0, 0, 0) - 2 * H; // local midnight (UTC+2)
  for (const key of ['A', 'B', 'D']) {
    let off = 0;
    for (let i = 0; i < 96; i++) if (scheduledOff(day0 + i * 0.25 * H, PROFILES[key])) off++;
    assert.ok(Math.abs(off / 4 - PROFILES[key].hours) <= 0.5, `profile ${key}: expected ~${PROFILES[key].hours} h off, got ${off / 4}`);
  }
  assert.equal(Math.round(localHour(day0)), 0);
});

// ---------------------------------------------------------------- rule engine
test('low fuel alert fires below threshold, reports litres, and is not duplicated', () => {
  makeSite('t-fuel');
  const a1 = ruleEngine.evaluateFuel('t-fuel', { level_pct: 15, generator_on: 0 });
  assert.equal(a1.length, 1);
  assert.match(a1[0].message, /150 L/);
  assert.equal(ruleEngine.evaluateFuel('t-fuel', { level_pct: 14, generator_on: 0 }).length, 0);
});

test('fuel theft: sudden drop with generator off fires; legitimate burn does not', () => {
  makeSite('t-theft');
  db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 0, ?)', ['t-theft', 80, ts(5 * 60000)]);
  db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 0, ?)', ['t-theft', 60, ts(0)]);
  const alerts = ruleEngine.evaluateFuel('t-theft', { level_pct: 60, generator_on: 0 });
  assert.ok(alerts.some((a) => a.type === 'fuel_theft' && /200 L/.test(a.message)));

  makeSite('t-legit');
  db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 1, ?)', ['t-legit', 80, ts(5 * 60000)]);
  db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 1, ?)', ['t-legit', 60, ts(0)]);
  assert.ok(!ruleEngine.evaluateFuel('t-legit', { level_pct: 60, generator_on: 1 }).some((a) => a.type === 'fuel_theft'));
});

test('site_down alert opens on power loss and auto-resolves on restore', () => {
  makeSite('t-down');
  assert.equal(ruleEngine.evaluatePowerState('t-down', false).length, 1);
  ruleEngine.evaluatePowerState('t-down', true);
  assert.equal(db.get(`SELECT status FROM alerts WHERE site_id = 't-down' AND type = 'site_down'`).status, 'resolved');
});

// ---------------------------------------------------------------- SLA
test('SLA: 100% with no downtime; ~50% with half the window down; down counts against SLA', () => {
  makeSite('t-sla-ok');
  assert.equal(sla.computeUptimePct('t-sla-ok', ts(H), ts(0)), 100);
  makeSite('t-sla-bad');
  db.run('INSERT INTO status_log (site_id, status, ts) VALUES (?, ?, ?)', ['t-sla-bad', 'down', ts(H / 2)]);
  const pct = sla.computeUptimePct('t-sla-bad', ts(H), ts(0));
  assert.ok(pct > 45 && pct < 55, `expected ~50%, got ${pct}`);
  const r = sla.computeSla('t-sla-bad', 1);
  assert.equal(r.breached, true);
  assert.equal(r.outageEvents, 1);
});

test('SLA computation does not write to the database (safe for GET)', () => {
  const before = db.get('SELECT COUNT(*) AS n FROM sla_breaches').n;
  sla.computeSla('t-sla-bad', 1);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM sla_breaches').n, before);
});

// ---------------------------------------------------------------- predictive
function seedBurnHistory(id, rateFn, days = 20, noise = 0) {
  // One generator run of 4 h per day at 15-min resolution.
  let level = 95;
  for (let d = days; d >= 1; d--) {
    const start = Date.now() - d * 86400000;
    db.run('INSERT INTO generator_runtime_log (site_id, event, ts) VALUES (?, ?, ?)', [id, 'start', db.toSqliteTs(start)]);
    for (let i = 0; i <= 16; i++) {
      if (i > 0) level -= ((rateFn(days - d) + (Math.random() - 0.5) * noise) * 0.25) / 10; // tank 1000 L → %
      db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 1, ?)', [id, level, db.toSqliteTs(start + i * 0.25 * H)]);
    }
    db.run('INSERT INTO generator_runtime_log (site_id, event, ts) VALUES (?, ?, ?)', [id, 'stop', db.toSqliteTs(start + 4 * H)]);
    if (level < 30) level = 95;
  }
}

test('predictive: rising burn rate is flagged with before/after values', () => {
  makeSite('t-pm-rise');
  seedBurnHistory('t-pm-rise', (d) => 2 + d * 0.03);
  const f = predictive.burnRateTrend('t-pm-rise');
  assert.ok(f, 'expected a flag');
  assert.ok(f.after > f.before);
  assert.match(f.explanation, /L\/h/);
});

test('predictive: flat but noisy burn rate is NOT flagged (significance test)', () => {
  makeSite('t-pm-flat');
  seedBurnHistory('t-pm-flat', () => 2, 20, 0.4);
  assert.equal(predictive.burnRateTrend('t-pm-flat'), null);
});

test('regression helper returns slope per day and a t-statistic', () => {
  const pts = [0, 1, 2, 3, 4].map((d) => ({ x: d * 86400000, y: 10 + 2 * d }));
  const r = predictive.regression(pts);
  assert.ok(Math.abs(r.slopePerDay - 2) < 1e-9);
});

// ---------------------------------------------------------------- fuel integrity
test('fuel integrity: separates slow off-generator loss and reconciles the litres', () => {
  makeSite('t-fi');
  // 10 days: generator runs 2 h/day at nameplate 2 L/h; 6 L disappears each night with generator off.
  let level = 90;
  for (let d = 10; d >= 1; d--) {
    const t0 = Date.now() - d * 86400000;
    db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 0, ?)', ['t-fi', level, db.toSqliteTs(t0)]);
    level -= 0.6; // 6 L siphoned, generator off
    db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 0, ?)', ['t-fi', level, db.toSqliteTs(t0 + 0.25 * H)]);
    db.run('INSERT INTO generator_runtime_log (site_id, event, ts) VALUES (?, ?, ?)', ['t-fi', 'start', db.toSqliteTs(t0 + H)]);
    for (let i = 0; i <= 8; i++) {
      if (i > 0) level -= 0.05; // 0.5 L per 15 min = 2 L/h
      db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, 1, ?)', ['t-fi', level, db.toSqliteTs(t0 + H + i * 0.25 * H)]);
    }
    db.run('INSERT INTO generator_runtime_log (site_id, event, ts) VALUES (?, ?, ?)', ['t-fi', 'stop', db.toSqliteTs(t0 + 3 * H)]);
  }
  const r = reconcileSite('t-fi', 11);
  assert.ok(Math.abs(r.expectedBurnL - 40) < 1, `expected burn ~40 L, got ${r.expectedBurnL}`);
  assert.ok(Math.abs(r.unexplainedL - 60) < 3, `unexplained ~60 L, got ${r.unexplainedL}`);
  assert.equal(r.finding, 'slow_siphoning');
});

// ---------------------------------------------------------------- resilience
function seedState(id, { fuelPct, socPct, gridUp }) {
  db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on) VALUES (?, ?, 0)', [id, fuelPct]);
  db.run('INSERT INTO battery_readings (site_id, soc_pct) VALUES (?, ?)', [id, socPct]);
  db.run('INSERT INTO power_readings (site_id, source, active) VALUES (?, ?, ?)', [id, 'grid', gridUp ? 1 : 0]);
}

test('resilience: less fuel means higher blackout probability (monotonic)', () => {
  makeSite('t-r-low', { tank_l: 300, battery_kwh: 5 });
  makeSite('t-r-high', { tank_l: 300, battery_kwh: 5 });
  seedState('t-r-low', { fuelPct: 5, socPct: 50, gridUp: false });
  seedState('t-r-high', { fuelPct: 95, socPct: 50, gridUp: false });
  const low = resilience.forecastSite(resilience.siteContext('t-r-low'), { scenarioH: 18 });
  const high = resilience.forecastSite(resilience.siteContext('t-r-high'), { scenarioH: 18 });
  assert.ok(low.pDark72h > high.pDark72h, `low ${low.pDark72h} vs high ${high.pDark72h}`);
  assert.equal(low.cause, 'fuel');
  assert.ok(low.survival[0].pPowered >= low.survival[72].pPowered);
});

test('resilience: battery-only site under heavy load-shedding is capacity-limited', () => {
  makeSite('t-r-cap', { gen_kw: 0, tank_l: 0, battery_kwh: 4 });
  seedState('t-r-cap', { fuelPct: 0, socPct: 100, gridUp: false });
  const f = resilience.forecastSite(resilience.siteContext('t-r-cap'), { scenarioH: 18 });
  assert.equal(f.cause, 'capacity');
  assert.ok(f.pDark24h > 0.9);
});

test('planner: adding battery to a battery-only site avoids dark hours and pays back', () => {
  resilience.invalidate();
  const p = resilience.planUpgrades({ scenarioH: 12, budgetK: 1e9 });
  const s = p.sites.find((x) => x.siteId === 't-r-cap');
  assert.ok(s.baseline.darkHours > 0);
  const bat = s.options.find((o) => o.key === 'battery');
  assert.ok(bat.avoidedDarkH > 0);
  assert.ok(p.fleet.darkHoursPerMonthAfter <= p.fleet.darkHoursPerMonthBefore);
});
