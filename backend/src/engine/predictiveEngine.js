'use strict';
/**
 * Predictive maintenance engine — real trend analysis (simple linear
 * regression slope) over historical time-series, not a random "risk score".
 * Two signals are implemented:
 *   1. Generator runtime trend: is the generator running MORE often over
 *      time relative to earlier weeks? (proxy for degrading grid/solar
 *      reliability or a generator needing service)
 *   2. Fuel efficiency trend: is fuel consumption per hour of generator
 *      runtime drifting upward? (proxy for engine inefficiency)
 * Both produce an explainable flag: the actual slope and what it means,
 * not just a label.
 */

const db = require('../db');

function saveMaintenanceFlag(siteId, component, trendSlope, explanation) {
  const existing = db.get(
    `SELECT id, explanation FROM maintenance_flags
     WHERE site_id = ? AND component = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [siteId, component]
  );

  if (existing && existing.explanation === explanation) return;

  db.run(
    `INSERT INTO maintenance_flags (site_id, component, trend_slope, explanation) VALUES (?, ?, ?, ?)`,
    [siteId, component, trendSlope, explanation]
  );
}

function linearRegressionSlope(points) {
  // points: [{x, y}], x in ms since first point (for numerical stability)
  const n = points.length;
  if (n < 3) return null;
  const x0 = points[0].x;
  const xs = points.map(p => (p.x - x0) / 3600000); // hours since first point
  const ys = points.map(p => p.y);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den; // units of y per hour
}

function evaluateGeneratorRuntimeTrend(siteId, days = 14) {
  const since = db.toSqliteTs(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const events = db.all(
    `SELECT event, ts FROM generator_runtime_log WHERE site_id = ? AND ts >= ? ORDER BY ts ASC`,
    [siteId, since]
  );
  if (events.length < 4) return null;

  // Bucket into daily runtime minutes, then regress runtime-per-day over time
  const dayBuckets = {};
  let openStart = null;
  for (const e of events) {
    const day = e.ts.slice(0, 10);
    if (e.event === 'start') openStart = new Date(e.ts).getTime();
    if (e.event === 'stop' && openStart) {
      const mins = (new Date(e.ts).getTime() - openStart) / 60000;
      dayBuckets[day] = (dayBuckets[day] || 0) + mins;
      openStart = null;
    }
  }
  const points = Object.entries(dayBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, mins]) => ({ x: new Date(day).getTime(), y: mins }));

  const slope = linearRegressionSlope(points); // minutes/hour trend, i.e. runtime change per hour elapsed
  if (slope == null) return null;

  const dailySlope = slope * 24; // minutes of runtime change per day
  if (dailySlope > 3) { // generator runtime growing by >3 min/day on average -> flag
    const explanation = `Generator daily runtime is increasing by ~${dailySlope.toFixed(1)} min/day over the last ${days} days — may indicate declining grid/solar reliability or generator wear requiring service.`;
    saveMaintenanceFlag(siteId, 'generator', dailySlope, explanation);
    return { siteId, component: 'generator', trendSlope: dailySlope, explanation };
  }
  return null;
}

function evaluateFuelEfficiencyTrend(siteId, days = 14) {
  const since = db.toSqliteTs(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const readings = db.all(
    `SELECT level_pct, generator_on, ts FROM fuel_readings WHERE site_id = ? AND ts >= ? ORDER BY ts ASC`,
    [siteId, since]
  );
  if (readings.length < 6) return null;

  // Consumption rate (%/hour) computed only across consecutive readings where generator was ON
  const points = [];
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1], cur = readings[i];
    if (prev.generator_on && cur.generator_on) {
      const hours = (new Date(cur.ts) - new Date(prev.ts)) / 3600000;
      if (hours > 0) {
        const ratePerHour = (prev.level_pct - cur.level_pct) / hours;
        if (ratePerHour >= 0) points.push({ x: new Date(cur.ts).getTime(), y: ratePerHour });
      }
    }
  }
  const slope = linearRegressionSlope(points); // (%/hour) change per hour elapsed
  if (slope == null) return null;

  const dailySlope = slope * 24;
  if (dailySlope > 0.05) { // burn rate worsening measurably over the window
    const explanation = `Generator fuel burn rate is rising by ~${dailySlope.toFixed(3)} %/hr each day over the last ${days} days — may indicate declining generator efficiency.`;
    saveMaintenanceFlag(siteId, 'fuel_system', dailySlope, explanation);
    return { siteId, component: 'fuel_system', trendSlope: dailySlope, explanation };
  }
  return null;
}

module.exports = { linearRegressionSlope, evaluateGeneratorRuntimeTrend, evaluateFuelEfficiencyTrend };
