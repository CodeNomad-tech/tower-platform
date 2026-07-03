'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
const db = require('../src/db');
const ruleEngine = require('../src/engine/ruleEngine');
const slaEngine = require('../src/engine/slaEngine');
const predictiveEngine = require('../src/engine/predictiveEngine');

function makeSite(id) {
  db.run('INSERT INTO sites (id, name, status) VALUES (?, ?, ?)', [id, id, 'online']);
  db.run('INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, 99.5)', [id]);
}

test('low fuel alert fires below threshold and not above', () => {
  makeSite('t-fuel-1');
  const alerts = ruleEngine.evaluateFuel('t-fuel-1', { level_pct: 15, generator_on: 0 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'low_fuel');

  makeSite('t-fuel-2');
  const noAlerts = ruleEngine.evaluateFuel('t-fuel-2', { level_pct: 80, generator_on: 0 });
  assert.equal(noAlerts.length, 0);
});

test('duplicate unresolved alerts are not created twice', () => {
  makeSite('t-dup');
  const first = ruleEngine.evaluateFuel('t-dup', { level_pct: 10, generator_on: 0 });
  const second = ruleEngine.evaluateFuel('t-dup', { level_pct: 8, generator_on: 0 });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0, 'second low_fuel alert should be suppressed while first is unresolved');
});

test('fuel theft detection fires on sharp drop while generator is off', () => {
  makeSite('t-theft');
  db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, ?, datetime(\'now\', \'-5 minutes\'))', ['t-theft', 80, 0]);
  const alerts = ruleEngine.evaluateFuel('t-theft', { level_pct: 55, generator_on: 0 });
  assert.ok(alerts.some(a => a.type === 'fuel_theft'), 'expected a fuel_theft alert');
});

test('fuel theft does NOT fire when generator is running (legitimate consumption)', () => {
  makeSite('t-legit');
  db.run('INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, ?, datetime(\'now\', \'-5 minutes\'))', ['t-legit', 80, 1]);
  const alerts = ruleEngine.evaluateFuel('t-legit', { level_pct: 55, generator_on: 1 });
  assert.ok(!alerts.some(a => a.type === 'fuel_theft'), 'should not flag theft while generator legitimately consumes fuel');
});

test('smoke detection always creates a critical alert', () => {
  makeSite('t-smoke');
  const alerts = ruleEngine.evaluateEnv('t-smoke', { smoke_detected: true, temperature_c: 30 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'critical');
});

test('SLA engine computes 100% uptime when no downtime logged', () => {
  makeSite('t-sla-ok');
  const pct = slaEngine.computeUptimePct('t-sla-ok', db.toSqliteTs(new Date(Date.now() - 3600000)), db.toSqliteTs(new Date()));
  assert.equal(pct, 100);
});

test('SLA engine detects reduced uptime after an offline period', () => {
  makeSite('t-sla-bad');
  const from = new Date(Date.now() - 3600000);
  db.run('INSERT INTO status_log (site_id, status, ts) VALUES (?, ?, ?)', ['t-sla-bad', 'offline', db.toSqliteTs(new Date(from.getTime() + 1800000))]);
  const pct = slaEngine.computeUptimePct('t-sla-bad', db.toSqliteTs(from), db.toSqliteTs(new Date()));
  assert.ok(pct < 60 && pct > 40, `expected ~50% uptime, got ${pct}`);
});

test('predictive engine: linear regression detects a rising trend', () => {
  const points = [
    { x: 0, y: 10 }, { x: 3600000, y: 12 }, { x: 7200000, y: 14 }, { x: 10800000, y: 16 },
  ];
  const slope = predictiveEngine.linearRegressionSlope(points);
  assert.ok(slope > 1.9 && slope < 2.1, `expected slope ~2/hr, got ${slope}`);
});

test('predictive engine: flat trend returns slope near zero', () => {
  const points = [{ x: 0, y: 10 }, { x: 3600000, y: 10 }, { x: 7200000, y: 10 }, { x: 10800000, y: 10 }];
  const slope = predictiveEngine.linearRegressionSlope(points);
  assert.ok(Math.abs(slope) < 0.01);
});
