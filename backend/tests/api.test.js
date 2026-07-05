'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DB = path.join(__dirname, '.test-api.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DB_PATH = TEST_DB;
process.env.PORT = '13999';
process.env.MQTT_PORT = '11999';
process.env.RUN_SIMULATOR = 'false';

const BASE = 'http://localhost:13999/api';
let token;

test('server boots', async () => {
  await require('../src/server').main();
});

test('rejects login with wrong credentials', async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@towerplatform.demo', password: 'wrong' }),
  });
  assert.equal(res.status, 401);
});

test('logs in with seeded demo admin', async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@towerplatform.demo', password: 'ChangeMe123!' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token);
  token = data.token;
});

test('rejects requests without a token', async () => {
  const res = await fetch(`${BASE}/sites`);
  assert.equal(res.status, 401);
});

test('lists seeded demo sites', async () => {
  const res = await fetch(`${BASE}/sites`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.sites.length, 4);
});

test('creates a new site', async () => {
  const res = await fetch(`${BASE}/sites`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: 'site-999', name: 'Test Site', capacity: 3 }),
  });
  assert.equal(res.status, 201);
});

test('registration rejects short passwords', async () => {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x@x.com', password: 'short' }),
  });
  assert.equal(res.status, 400);
});

test('tenancy: add a tenant and see occupancy reflected', async () => {
  const add = await fetch(`${BASE}/tenancy/site-999/tenants`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Test Tenant', contract_value_monthly: 1000 }),
  });
  assert.equal(add.status, 201);

  const summary = await (await fetch(`${BASE}/tenancy`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const site999 = summary.sites.find(s => s.siteId === 'site-999');
  assert.equal(site999.tenantCount, 1);
  assert.ok(Math.abs(site999.occupancyPct - 33.33) < 1);
});

test('alerts: acknowledge and resolve lifecycle persists', async () => {
  // Trigger a low-fuel alert directly via the fuel ingest path isn't exposed over HTTP,
  // so we exercise the alert lifecycle against the rule engine's created record via the API.
  const ruleEngine = require('../src/engine/ruleEngine');
  const created = ruleEngine.createAlert({ siteId: 'site-999', type: 'low_fuel', severity: 'warning', message: 'test alert' });
  assert.ok(created);

  const ackRes = await fetch(`${BASE}/alerts/${created.id}/acknowledge`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(ackRes.status, 200);
  const acked = await ackRes.json();
  assert.equal(acked.alert.status, 'acknowledged');
  assert.ok(acked.alert.acknowledged_at);

  const resolveRes = await fetch(`${BASE}/alerts/${created.id}/resolve`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const resolved = await resolveRes.json();
  assert.equal(resolved.alert.status, 'resolved');
});

test('AI endpoints expose fleet intelligence and anomalies', async () => {
  const fleetRes = await fetch(`${BASE}/ai/fleet-summary`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(fleetRes.status, 200);
  const fleet = await fleetRes.json();
  assert.ok(fleet.narrative);
  assert.equal(fleet.sites.length, 4);
  assert.ok(fleet.sites.every(site => ['LOW', 'MEDIUM', 'HIGH'].includes(site.riskLevel)));
  assert.ok(typeof fleet.monthlyRevenue === 'number');

  const anomaliesRes = await fetch(`${BASE}/ai/anomalies`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(anomaliesRes.status, 200);
  const anomalies = await anomaliesRes.json();
  assert.ok(Array.isArray(anomalies.anomalies));
  assert.ok(anomalies.anomalies.every(a => ['FUEL_THEFT', 'PREDICTIVE_MAINTENANCE', 'SLA_BREACH'].includes(a.type)));
});

test('CSV export produces well-formed content', async () => {
  const res = await fetch(`${BASE}/reports/export/uptime.csv`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.startsWith('site_id,site_name,uptime_pct_30d'));
});

test('cleanup: remove test db file', () => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});
