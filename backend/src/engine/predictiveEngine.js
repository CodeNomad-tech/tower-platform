'use strict';
/**
 * Predictive maintenance indicators: trend analysis over each site's own history.
 * Signals:
 *   1. Generator burn rate (L/h while running): a rising rate at constant load
 *      is a classic early sign of injector/air-filter wear or a fuel leak.
 *   2. Generator runtime per day: rising runtime means the site leans harder
 *      on diesel (grid deteriorating, solar or battery under-performing).
 * Each flag carries the slope, the before/after values and a plain-language
 * explanation. Computation is pure; persistence happens only in the
 * background job (persistFlags), never on GET requests.
 */

const db = require('../db');

// Ordinary least squares with the slope's standard error (for a significance test).
function regression(points) {
  const n = points.length;
  if (n < 3) return null;
  const x0 = points[0].x;
  const xs = points.map(p => (p.x - x0) / 86400000); // days
  const ys = points.map(p => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : Infinity;
  return { slopePerDay: slope, intercept, se, t: se > 0 ? slope / se : Infinity, spanDays: xs[n - 1], n };
}

function linearRegressionSlope(points) {
  const n = points.length;
  if (n < 3) return null;
  const x0 = points[0].x;
  const xs = points.map(p => (p.x - x0) / 3600000);
  const ys = points.map(p => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den; // y-units per hour
}

function tank(siteId) { return db.get('SELECT tank_l FROM site_assets WHERE site_id = ?', [siteId])?.tank_l || null; }

/**
 * Splits fuel-level changes into: litres burned while the generator ran, and
 * litres lost while it was OFF (excluding refuels). Pairs of consecutive
 * readings more than 20 minutes apart are skipped (data gap).
 */
function fuelFlows(siteId, sinceTs) {
  const t = tank(siteId);
  if (!t) return null;
  const rows = db.all('SELECT level_pct, generator_on, ts FROM fuel_readings WHERE site_id = ? AND ts >= ? ORDER BY ts, id', [siteId, sinceTs]);
  const byDay = new Map();
  let genL = 0, genH = 0, offL = 0, offH = 0;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], c = rows[i];
    const dtH = (db.tsToMs(c.ts) - db.tsToMs(p.ts)) / 3600000;
    if (dtH <= 0 || dtH > 20 / 60) continue;
    const dropL = ((p.level_pct - c.level_pct) / 100) * t;
    if (dropL < -1) continue; // refuel
    const day = c.ts.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { genL: 0, genH: 0 });
    if (p.generator_on && c.generator_on) {
      genL += Math.max(0, dropL); genH += dtH;
      const d = byDay.get(day); d.genL += Math.max(0, dropL); d.genH += dtH;
    } else if (!p.generator_on && !c.generator_on) {
      // Sudden drops are theft EVENTS (reported by Fuel Integrity), not a standing loss rate.
      if (dropL < Math.max(40, t * 0.08)) offL += Math.max(0, dropL);
      offH += dtH;
    }
  }
  return { tankL: t, genL, genH, offL, offH, byDay, burnLph: genH > 0.5 ? genL / genH : null, standingLossLph: offH > 1 ? offL / offH : 0 };
}

function burnRateTrend(siteId, days = 30) {
  const flows = fuelFlows(siteId, db.toSqliteTs(Date.now() - days * 86400000));
  if (!flows) return null;
  // Daily burn rate, only from days with enough runtime for a stable estimate.
  const pts = [...flows.byDay.entries()]
    .filter(([, d]) => d.genH >= 3)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({ x: Date.parse(day + 'T12:00:00Z'), y: d.genL / d.genH }));
  if (pts.length < 8) return null;
  const r = regression(pts);
  if (!r) return null;
  const before = r.intercept, after = r.intercept + r.slopePerDay * r.spanDays;
  const relChange = (after - before) / Math.max(0.1, before);
  // Flag only a material (≥10%) and statistically significant (t ≥ 3) upward trend.
  if (relChange < 0.10 || r.t < 3) return null;
  const extraLPerMonth = Math.max(0, after - before) * (flows.genH / Math.max(1, r.spanDays)) * 30;
  return {
    siteId, component: 'generator_fuel_system', trendSlope: r.slopePerDay, tStat: r.t, days: pts.length,
    before, after, extraLitresPerMonth: extraLPerMonth,
    explanation: `Generator burn rate rose from ~${before.toFixed(2)} to ~${after.toFixed(2)} L/h over ${Math.round(r.spanDays)} days (+${(relChange * 100).toFixed(0)}%, t=${r.t.toFixed(1)}) at constant load. Check injectors, air filter and fuel lines. At current runtime this wastes ~${Math.round(extraLPerMonth)} L/month.`,
  };
}

function generatorRuntimeTrend(siteId, days = 14) {
  const since = db.toSqliteTs(Date.now() - days * 86400000);
  const ev = db.all('SELECT event, ts FROM generator_runtime_log WHERE site_id = ? AND ts >= ? ORDER BY ts, id', [siteId, since]);
  if (ev.length < 6) return null;
  const perDay = new Map();
  let open = null;
  for (const e of ev) {
    if (e.event === 'start') open = db.tsToMs(e.ts);
    else if (open != null) {
      const day = e.ts.slice(0, 10);
      perDay.set(day, (perDay.get(day) || 0) + (db.tsToMs(e.ts) - open) / 3600000);
      open = null;
    }
  }
  const pts = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, h]) => ({ x: Date.parse(d + 'T12:00:00Z'), y: h }));
  if (pts.length < 5) return null;
  const slopePerDay = linearRegressionSlope(pts) * 24; // hours of runtime added per day
  if (slopePerDay < 0.25) return null;
  return {
    siteId, component: 'generator_runtime', trendSlope: slopePerDay,
    explanation: `Generator runtime is growing by ~${(slopePerDay * 60).toFixed(0)} min/day over ${days} days. The site leans harder on diesel; check grid supply, battery health and solar output.`,
  };
}

function mean(a) { return a.reduce((s, v) => s + v, 0) / (a.length || 1); }

function siteFlags(siteId) {
  return [burnRateTrend(siteId), generatorRuntimeTrend(siteId)].filter(Boolean);
}

// Background job: persists at most one flag per site+component per day.
function persistFlags(siteId) {
  const out = [];
  for (const f of siteFlags(siteId)) {
    const recent = db.get(`SELECT id FROM maintenance_flags WHERE site_id = ? AND component = ? AND created_at >= datetime('now', '-1 day')`, [siteId, f.component]);
    if (!recent) {
      db.run('INSERT INTO maintenance_flags (site_id, component, trend_slope, explanation) VALUES (?, ?, ?, ?)', [siteId, f.component, f.trendSlope, f.explanation]);
      out.push(f);
    }
  }
  return out;
}

module.exports = { regression, linearRegressionSlope, fuelFlows, burnRateTrend, generatorRuntimeTrend, siteFlags, persistFlags };
