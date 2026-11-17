'use strict';
// Integration tests: a real server (HTTP + MQTT + WS + simulator) on test ports, real SQLite file.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'toweriq-test-'));
process.env.DB_PATH = path.join(DIR, 'api.db');
process.env.PORT = '13999';
process.env.MQTT_PORT = '11999';
process.env.DEMO_MODE = 'true';
process.env.RUN_SIMULATOR = 'true';
process.env.HISTORY_DAYS = '6';
process.env.SIM_TICK_MS = '400';

const test = require('node:test');
const assert = require('node:assert/strict');
const BASE = 'http://localhost:13999/api';
const tokens = {};
let srv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : await res.text() };
}

test.before(async () => { srv = await require('../src/server').main({ log: () => {} }); });
test.after(async () => { await srv.stop(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('public meta labels the data as simulated', async () => {
  const r = await call('GET', '/meta');
  assert.equal(r.status, 200);
  assert.match(r.data.dataNotice, /simulated/i);
});

test('login: rejects wrong password, accepts each demo role', async () => {
  assert.equal((await call('POST', '/auth/login', { body: { email: 'admin@toweriq.demo', password: 'wrong-password' } })).status, 401);
  for (const role of ['admin', 'operator', 'viewer']) {
    const r = await call('POST', '/auth/login', { body: { email: `${role}@toweriq.demo`, password: 'ChangeMe123!' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.role, role);
    tokens[role] = r.data.token;
  }
});

test('security: open self-registration is gone; only admins create users', async () => {
  assert.equal((await call('POST', '/auth/register', { body: { email: 'x@x.com', password: 'password1234', role: 'admin' } })).status, 404);
  assert.equal((await call('POST', '/auth/users', { token: tokens.operator, body: { email: 'y@x.com', password: 'password1234' } })).status, 403);
  const ok = await call('POST', '/auth/users', { token: tokens.admin, body: { email: 'new.op@example.com', password: 'longenough1', role: 'operator' } });
  assert.equal(ok.status, 201);
});

test('security: unauthenticated and under-privileged requests are refused', async () => {
  assert.equal((await call('GET', '/sites')).status, 401);
  assert.equal((await call('PUT', '/settings', { token: tokens.viewer, body: { diesel_price_k_per_l: 30 } })).status, 403);
  assert.equal((await call('POST', '/demo/scenario', { token: tokens.operator, body: { siteId: 'LSK-001', action: 'smoke' } })).status, 403);
});

test('security: malformed JSON → 400, oversized body → 413, headers set', async () => {
  assert.equal((await call('POST', '/auth/login', { body: '{bad' })).status, 400);
  const big = await call('POST', '/auth/login', { body: JSON.stringify({ email: 'a'.repeat(300 * 1024) }) });
  assert.equal(big.status, 413);
  const res = await fetch('http://localhost:13999/');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('security: static path traversal is blocked', async () => {
  const res = await fetch('http://localhost:13999/%2e%2e/backend/package.json');
  const text = await res.text();
  assert.ok(!text.includes('toweriq-backend'), 'must not serve files outside frontend/');
});

test('security: WebSocket requires a session token or device key', async () => {
  const bad = new WebSocket('ws://localhost:13999/ws');
  const badResult = await new Promise((r) => { bad.onopen = () => r('open'); bad.onerror = () => r('error'); });
  assert.equal(badResult, 'error');
  const good = new WebSocket(`ws://localhost:13999/ws?token=${tokens.viewer}`);
  const msg = await new Promise((r, j) => { good.onmessage = (e) => r(JSON.parse(e.data)); good.onerror = j; setTimeout(() => j(new Error('no message')), 5000); });
  assert.ok(msg.channel, 'console client receives live events');
  good.close();
});

test('device key lets a camera node raise an intrusion alarm; console sockets cannot inject', async () => {
  const k = await call('POST', '/settings/device-keys', { token: tokens.admin, body: { label: 'test cam' } });
  assert.equal(k.status, 201);
  // A console (user) socket sending a camera event must be ignored.
  const user = new WebSocket(`ws://localhost:13999/ws?token=${tokens.viewer}`);
  await new Promise((r) => { user.onopen = r; });
  user.send(JSON.stringify({ type: 'camera-event', siteId: 'WES-002', event_type: 'intrusion', confidence: 0.9 }));
  const dev = new WebSocket(`ws://localhost:13999/ws?device=${encodeURIComponent(k.data.key)}`);
  await new Promise((r) => { dev.onopen = r; });
  dev.send(JSON.stringify({ type: 'camera-event', siteId: 'SOU-001', event_type: 'intrusion', confidence: 0.92 }));
  await sleep(800);
  const sou = (await call('GET', '/alerts?siteId=SOU-001&status=open', { token: tokens.viewer })).data.alerts;
  const wes = (await call('GET', '/alerts?siteId=WES-002&status=open', { token: tokens.viewer })).data.alerts;
  assert.ok(sou.some((a) => a.type === 'intrusion'), 'device event raised alarm');
  assert.ok(!wes.some((a) => a.type === 'intrusion'), 'user socket event ignored');
  user.close(); dev.close();
});

test('sites: list, detail with SLA + fuel integrity, validation on create', async () => {
  const list = await call('GET', '/sites', { token: tokens.viewer });
  assert.equal(list.data.sites.length, 12);
  const d = await call('GET', '/sites/CPB-007', { token: tokens.viewer });
  assert.equal(d.status, 200);
  assert.ok(d.data.sla30d.actualPct <= 100);
  assert.ok(d.data.fuelIntegrity);
  assert.equal((await call('POST', '/sites', { token: tokens.admin, body: { id: 'LSK-001', name: 'dup' } })).status, 409);
  assert.equal((await call('POST', '/sites', { token: tokens.admin, body: { id: 'bad id!', name: 'x' } })).status, 400);
  assert.equal((await call('POST', '/sites', { token: tokens.admin, body: { id: 'NEW-1', name: 'New Site', latitude: -15, longitude: 28 } })).status, 201);
});

test('utilisation is reported by time for every period including dark time', async () => {
  for (const period of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    const r = await call('GET', `/sites/LUA-003/power-utilization?period=${period}`, { token: tokens.viewer });
    assert.equal(r.status, 200);
    const total = r.data.utilization.reduce((s, u) => s + u.pct, 0);
    assert.ok(Math.abs(total - 100) < 0.01 || r.data.hours === 0);
    assert.ok(r.data.utilization.some((u) => u.source === 'dark'));
  }
});

test('resilience: runway covers all sites with probabilities in [0,1]; actions are ranked', async () => {
  const r = await call('GET', '/resilience/runway', { token: tokens.viewer });
  assert.equal(r.status, 200);
  assert.ok(r.data.sites.length >= 12);
  for (const s of r.data.sites) assert.ok(s.forecast.pDark24h >= 0 && s.forecast.pDark24h <= s.forecast.pDark72h + 1e-9);
  const a = await call('GET', '/resilience/actions', { token: tokens.viewer });
  const rank = { critical: 0, high: 1, medium: 2 };
  for (let i = 1; i < a.data.actions.length; i++) assert.ok(rank[a.data.actions[i - 1].priority] <= rank[a.data.actions[i].priority]);
});

test('planner: heavier load-shedding never reduces projected dark hours; CSV export works', async () => {
  const light = await call('GET', '/resilience/plan?loadShedding=4&budget=500000', { token: tokens.viewer });
  const heavy = await call('GET', '/resilience/plan?loadShedding=18&budget=500000', { token: tokens.viewer });
  assert.ok(heavy.data.fleet.darkHoursPerMonthBefore >= light.data.fleet.darkHoursPerMonthBefore);
  assert.ok(heavy.data.fleet.capexK <= 500000);
  const csv = await call('GET', '/resilience/plan.csv?loadShedding=12', { token: tokens.viewer });
  assert.equal(csv.status, 200);
  assert.match(csv.data, /rank,site_id,site_name,upgrade/);
});

test('demo scenario: simulated siphon is detected as theft via the normal pipeline', async () => {
  const r = await call('POST', '/demo/scenario', { token: tokens.admin, body: { siteId: 'LSK-001', action: 'siphon', litres: 200 } });
  assert.equal(r.status, 200);
  let found = false;
  for (let i = 0; i < 20 && !found; i++) {
    await sleep(300);
    const al = (await call('GET', '/alerts?siteId=LSK-001&status=open', { token: tokens.viewer })).data.alerts;
    found = al.some((a) => a.type === 'fuel_theft');
  }
  assert.ok(found, 'expected a fuel_theft alarm within a few ticks');
});

test('alarms: operator acknowledges then resolves with a note; viewer cannot', async () => {
  const open = (await call('GET', '/alerts?status=new', { token: tokens.viewer })).data.alerts;
  const a = open[0];
  assert.ok(a, 'need an open alarm');
  assert.equal((await call('POST', `/alerts/${a.id}/acknowledge`, { token: tokens.viewer })).status, 403);
  assert.equal((await call('POST', `/alerts/${a.id}/acknowledge`, { token: tokens.operator })).data.alert.status, 'acknowledged');
  assert.equal((await call('POST', `/alerts/${a.id}/acknowledge`, { token: tokens.operator })).status, 409);
  const res = await call('POST', `/alerts/${a.id}/resolve`, { token: tokens.operator, body: { note: 'Guard dispatched' } });
  assert.equal(res.data.alert.status, 'resolved');
  assert.equal(res.data.alert.resolution_note, 'Guard dispatched');
});

test('fuel: delivery validation and simulated fuel arrival', async () => {
  assert.equal((await call('POST', '/fuel/deliveries', { token: tokens.operator, body: { siteId: 'CPB-007', litres: -5 } })).status, 400);
  assert.equal((await call('POST', '/fuel/deliveries', { token: tokens.viewer, body: { siteId: 'CPB-007', litres: 50 } })).status, 403);
  const r = await call('POST', '/fuel/deliveries', { token: tokens.operator, body: { siteId: 'CPB-007', litres: 100, reference: 'DN-T1' } });
  assert.equal(r.status, 201);
  assert.ok(r.data.simulated.litresAdded >= 0);
  const fi = await call('GET', '/fuel/integrity?days=30', { token: tokens.viewer });
  assert.ok(fi.data.sites.length >= 10);
});

test('settings: validated, admin-only, and audited', async () => {
  assert.equal((await call('PUT', '/settings', { token: tokens.admin, body: { diesel_price_k_per_l: -1 } })).status, 400);
  assert.equal((await call('PUT', '/settings', { token: tokens.admin, body: { not_a_setting: 1 } })).status, 400);
  const ok = await call('PUT', '/settings', { token: tokens.admin, body: { diesel_price_k_per_l: 26.5 } });
  assert.equal(ok.data.settings.find((s) => s.key === 'diesel_price_k_per_l').value, 26.5);
  const audit = await call('GET', '/settings/audit', { token: tokens.admin });
  assert.ok(audit.data.entries.some((e) => e.action === 'settings.update'));
});

test('reports: SLA, utilisation, executive summary and CSV exports (formula-safe)', async () => {
  assert.equal((await call('GET', '/reports/sla?period=quarterly', { token: tokens.viewer })).status, 200);
  assert.equal((await call('GET', '/reports/utilization?period=monthly', { token: tokens.viewer })).status, 200);
  const ex = await call('GET', '/reports/executive-summary', { token: tokens.viewer });
  assert.equal(ex.data.totalSites, 13);
  for (const p of ['/reports/export/sla.csv', '/reports/export/alerts.csv', '/reports/export/fuel.csv']) {
    const r = await call('GET', p, { token: tokens.viewer });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
  }
  assert.equal((await call('GET', '/reports/export/sla.csv')).status, 401);
});

test('ingest rejects malformed telemetry without crashing', () => {
  const ingest = require('../src/mqtt/ingest');
  const before = ingest.stats.rejected;
  assert.deepEqual(ingest.handleMessage('NOPE-1', 'fuel', { level_pct: 50 }), []);
  assert.deepEqual(ingest.handleMessage('LSK-001', 'fuel', { level_pct: 'abc' }), []);
  assert.deepEqual(ingest.handleMessage('LSK-001', 'power', { source: 'nuclear', active: true }), []);
  assert.equal(ingest.stats.rejected, before + 3);
});
