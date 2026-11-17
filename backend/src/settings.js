'use strict';
/**
 * Business assumptions used by the Resilience Engine and Fuel Integrity
 * reports. They are deliberately visible and editable (admin Settings page)
 * because every Kwacha figure in TowerIQ is only as good as these numbers.
 */

const db = require('./db');

const DEFINITIONS = {
  diesel_price_k_per_l: {
    default: 25.11, min: 1, max: 200, unit: 'K/L', label: 'Diesel price',
    source: 'ERB national pump price, January 2026 review (update monthly)',
  },
  sla_credit_multiplier: {
    default: 5, min: 0, max: 50, unit: '× pro-rata', label: 'SLA credit multiplier',
    source: 'Assumption: service credit per dark hour = tenant monthly fee ÷ 730 h × this multiplier. Replace with actual MSA terms.',
  },
  battery_cost_k_per_kwh: {
    default: 7500, min: 0, max: 100000, unit: 'K/kWh', label: 'Battery installed cost',
    source: 'Planning assumption (LiFePO4, installed). Replace with procurement quotes.',
  },
  solar_cost_k_per_kw: {
    default: 18000, min: 0, max: 200000, unit: 'K/kWp', label: 'Solar installed cost',
    source: 'Planning assumption (PV + MPPT, installed). Replace with procurement quotes.',
  },
  refuel_trigger_pct: {
    default: 25, min: 5, max: 80, unit: '%', label: 'Refuel request trigger',
    source: 'Operating policy used when projecting a month ahead.',
  },
  dark_risk_tolerance_pct: {
    default: 10, min: 1, max: 50, unit: '%', label: 'Acceptable blackout risk before acting',
    source: 'Refuel-by deadline = time at which blackout probability reaches this level.',
  },
};

let cache = null;

function getAll() {
  if (cache) return cache;
  const rows = db.all('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map(r => [r.key, Number(r.value)]));
  cache = {};
  for (const [k, def] of Object.entries(DEFINITIONS)) cache[k] = Number.isFinite(stored[k]) ? stored[k] : def.default;
  return cache;
}

function get(key) { return getAll()[key]; }

function set(key, value) {
  const def = DEFINITIONS[key];
  if (!def) throw Object.assign(new Error(`Unknown setting: ${key}`), { status: 400 });
  const n = Number(value);
  if (!Number.isFinite(n) || n < def.min || n > def.max) {
    throw Object.assign(new Error(`${def.label} must be a number between ${def.min} and ${def.max}`), { status: 400 });
  }
  db.run(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [key, String(n)]);
  cache = null;
  return n;
}

function describe() {
  const values = getAll();
  return Object.entries(DEFINITIONS).map(([key, d]) => ({ key, value: values[key], ...d }));
}

module.exports = { get, getAll, set, describe, DEFINITIONS };
