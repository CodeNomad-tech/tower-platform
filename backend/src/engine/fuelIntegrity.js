'use strict';
/**
 * Fuel Integrity: reconciles every litre at each site over a period.
 *
 *   opening stock + deliveries − expected generator burn − closing stock = UNEXPLAINED LOSS
 *
 * "Expected burn" uses the site's NAMEPLATE burn rate (commissioning value)
 * × measured generator runtime. It deliberately does not use the burn rate
 * calibrated from data, because that data may already contain theft.
 * Unexplained loss is then split into:
 *   - sudden drops (≥ theft threshold within 15 min, generator off): likely theft events
 *   - gradual off-generator drain: slow siphoning or leaks
 *   - excess burn while running: generator inefficiency (or siphoning while running)
 * Small differences (< tolerance) are treated as sensor noise.
 */

const db = require('../db');
const settings = require('../settings');

const NOISE_TOLERANCE_PCT_OF_TANK = 2;

function runtimeHours(siteId, fromTs, toTs) {
  const prev = db.get('SELECT event FROM generator_runtime_log WHERE site_id = ? AND ts < ? ORDER BY ts DESC, id DESC LIMIT 1', [siteId, fromTs]);
  const ev = db.all('SELECT event, ts FROM generator_runtime_log WHERE site_id = ? AND ts >= ? AND ts <= ? ORDER BY ts, id', [siteId, fromTs, toTs]);
  let on = prev && prev.event === 'start' ? db.tsToMs(fromTs) : null;
  let h = 0;
  for (const e of ev) {
    const t = db.tsToMs(e.ts);
    if (e.event === 'start' && on == null) on = t;
    else if (e.event === 'stop' && on != null) { h += (t - on) / 3600000; on = null; }
  }
  if (on != null) h += (db.tsToMs(toTs) - on) / 3600000;
  return h;
}

function reconcileSite(siteId, days = 30) {
  const assets = db.get('SELECT tank_l, gen_burn_lph, gen_kw FROM site_assets WHERE site_id = ?', [siteId]);
  if (!assets || !assets.gen_kw) return null;
  const site = db.get('SELECT id, name, region FROM sites WHERE id = ?', [siteId]);
  const toTs = db.toSqliteTs(Date.now());
  const fromTs = db.toSqliteTs(Date.now() - days * 86400000);
  const tank = assets.tank_l;
  const price = settings.get('diesel_price_k_per_l');

  const open = db.get('SELECT level_pct FROM fuel_readings WHERE site_id = ? AND ts >= ? ORDER BY ts, id LIMIT 1', [siteId, fromTs]);
  const close = db.get('SELECT level_pct FROM fuel_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [siteId]);
  if (!open || !close) return null;
  const openingL = (open.level_pct / 100) * tank;
  const closingL = (close.level_pct / 100) * tank;
  const deliveries = db.all('SELECT litres, ts, supplier, reference FROM fuel_deliveries WHERE site_id = ? AND ts >= ? ORDER BY ts', [siteId, fromTs]);
  const deliveredL = deliveries.reduce((s, d) => s + d.litres, 0);
  const runH = runtimeHours(siteId, fromTs, toTs);
  const expectedBurnL = runH * assets.gen_burn_lph;
  const unexplainedRaw = openingL + deliveredL - expectedBurnL - closingL;
  const tolerance = (NOISE_TOLERANCE_PCT_OF_TANK / 100) * tank;
  const unexplainedL = Math.abs(unexplainedRaw) <= tolerance ? 0 : unexplainedRaw;

  // Classify movements from the level series itself.
  const rows = db.all('SELECT level_pct, generator_on, ts FROM fuel_readings WHERE site_id = ? AND ts >= ? ORDER BY ts, id', [siteId, fromTs]);
  const events = [];
  let gradualOffL = 0, burnWhileOnL = 0, hoursOn = 0;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], c = rows[i];
    const dtMin = (db.tsToMs(c.ts) - db.tsToMs(p.ts)) / 60000;
    if (dtMin <= 0 || dtMin > 20) continue;
    const dropL = ((p.level_pct - c.level_pct) / 100) * tank;
    if (dropL < -1) continue; // refuel
    if (!p.generator_on && !c.generator_on) {
      if (dropL >= Math.max(40, tank * 0.08)) events.push({ ts: c.ts, litres: Math.round(dropL), valueK: Math.round(dropL * price), kind: 'sudden_drop' });
      else if (dropL > 0) gradualOffL += dropL;
    } else if (p.generator_on && c.generator_on) {
      // Count every running interval, including those where the gauge didn't move
      // (sensor resolution); otherwise the measured rate is biased upwards.
      burnWhileOnL += Math.max(0, dropL);
      hoursOn += dtMin / 60;
    }
  }
  const suddenL = events.reduce((s, e) => s + e.litres, 0);
  // Measured burn rate while running vs nameplate, applied to total runtime.
  const measuredBurnLph = hoursOn > 1 ? burnWhileOnL / hoursOn : null;
  const excessBurnL = measuredBurnLph ? Math.max(0, measuredBurnLph - assets.gen_burn_lph) * runH : 0;
  let finding = 'reconciled';
  if (unexplainedL > 0) {
    if (suddenL >= unexplainedL * 0.5) finding = 'theft_events';
    else if (gradualOffL >= unexplainedL * 0.4) finding = 'slow_siphoning';
    else if (excessBurnL >= unexplainedL * 0.4) finding = 'excess_burn';
    else finding = 'unexplained';
  }
  const findingText = {
    reconciled: 'Fuel fully accounted for within sensor tolerance.',
    theft_events: `${events.length} sudden drop${events.length === 1 ? '' : 's'} with the generator off account for most of the loss: probable theft.`,
    slow_siphoning: `Level falls steadily while the generator is OFF (~${Math.round(gradualOffL)} L over ${days} days): pattern consistent with siphoning or a leak.`,
    excess_burn: `Generator burns more than its nameplate rate (+${Math.round(excessBurnL)} L): inefficiency, or siphoning while running.`,
    unexplained: 'Loss does not match a single pattern; audit deliveries and sensor calibration.',
  }[finding];

  return {
    siteId, name: site.name, region: site.region, days, tankL: tank,
    openingL, deliveredL, deliveries: deliveries.length, runtimeHours: runH, nameplateBurnLph: assets.gen_burn_lph,
    measuredBurnLph, expectedBurnL, closingL, unexplainedL, unexplainedValueK: Math.max(0, unexplainedL) * price,
    lossPctOfDeliveries: deliveredL > 0 ? Math.max(0, unexplainedL) / deliveredL * 100 : null,
    breakdown: { suddenDropsL: suddenL, gradualOffGeneratorL: gradualOffL, excessBurnL },
    events, finding, findingText,
  };
}

function fleetIntegrity(days = 30) {
  const sites = db.all('SELECT id FROM sites ORDER BY id').map(s => reconcileSite(s.id, days)).filter(Boolean);
  sites.sort((a, b) => b.unexplainedL - a.unexplainedL);
  const lossL = sites.reduce((s, x) => s + Math.max(0, x.unexplainedL), 0);
  return {
    days, dieselPriceK: settings.get('diesel_price_k_per_l'),
    fleet: {
      deliveredL: sites.reduce((s, x) => s + x.deliveredL, 0),
      expectedBurnL: sites.reduce((s, x) => s + x.expectedBurnL, 0),
      unexplainedL: lossL, unexplainedValueK: lossL * settings.get('diesel_price_k_per_l'),
      sitesWithLoss: sites.filter(x => x.unexplainedL > 0).length,
      annualisedValueK: lossL * settings.get('diesel_price_k_per_l') * (365 / days),
    },
    sites,
  };
}

module.exports = { reconcileSite, fleetIntegrity, runtimeHours };
