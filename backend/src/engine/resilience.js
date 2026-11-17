'use strict';
/**
 * RESILIENCE ENGINE: TowerIQ's signature capability.
 *
 * Question 1 (tonight):     Which towers will go dark, when, and why?            → forecastSite / fleetRunway
 * Question 2 (right now):   What should the NOC do first, by when, worth how much? → actionQueue
 * Question 3 (this quarter): Which battery/solar upgrades remove the most downtime
 *                            per Kwacha under a given load-shedding scenario?      → planUpgrades
 *
 * Method (fully explainable; see docs/RESILIENCE_ENGINE.md):
 *  - Start from each site's live state (fuel litres, battery SoC, generator, grid).
 *  - Grid behaviour: a 2-state Markov chain per hour of day LEARNED from the
 *    site's own 14-day telemetry, or a load-shedding SCENARIO chosen by the user.
 *  - Burn rate CALIBRATED from observed fuel drop while the generator ran,
 *    plus any observed standing loss while it was off (leaks/siphoning).
 *  - Monte Carlo: N runs of the site power model (engine/powerModel.js) at
 *    15-minute steps; report blackout probability, time-to-dark distribution,
 *    expected dark hours, the cause, and the Kwacha exposure.
 */

const db = require('../db');
const settings = require('../settings');
const { step, rng, localHour, solarShape } = require('./powerModel');
const { PROFILES, STEP_H, scheduleSimulator, scenarioProfile, learnMarkov, markovSimulator } = require('./gridModel');
const { fuelFlows } = require('./predictiveEngine');

const STEP_MS = STEP_H * 3600000;
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
function invalidate() { cache.clear(); }

// ----------------------------------------------------------------------------
// Site context: everything the forecast needs, from the database.
// ----------------------------------------------------------------------------
function siteContext(siteId) {
  const site = db.get('SELECT * FROM sites WHERE id = ?', [siteId]);
  if (!site) return null;
  const assets = db.get('SELECT * FROM site_assets WHERE site_id = ?', [siteId]);
  if (!assets) return { site, assets: null };

  const fuel = db.get('SELECT level_pct, generator_on, ts FROM fuel_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [siteId]);
  const batt = db.get('SELECT soc_pct, ts FROM battery_readings WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 1', [siteId]);
  const grid = db.get(`SELECT active FROM power_readings WHERE site_id = ? AND source = 'grid' ORDER BY ts DESC, id DESC LIMIT 1`, [siteId]);
  const active = db.get('SELECT source FROM power_readings WHERE site_id = ? AND active = 1 ORDER BY ts DESC, id DESC LIMIT 1', [siteId]);
  const markov = cached(`markov:${siteId}`, 10 * 60000, () => learnMarkov(siteId, 14));
  const flows = cached(`flows:${siteId}`, 5 * 60000, () => fuelFlows(siteId, db.toSqliteTs(Date.now() - 14 * 86400000)));
  const revenue = db.get('SELECT COALESCE(SUM(contract_value_monthly), 0) AS r, COUNT(*) AS n FROM tenants WHERE site_id = ?', [siteId]);

  const exposurePerDarkHourK = (revenue.r / 730) * settings.get('sla_credit_multiplier');
  return {
    site, assets,
    state: {
      fuelL: fuel ? (fuel.level_pct / 100) * assets.tank_l : 0,
      fuelPct: fuel ? fuel.level_pct : null,
      socKwh: batt ? (batt.soc_pct / 100) * assets.battery_kwh : 0,
      socPct: batt ? batt.soc_pct : null,
      genOn: !!(fuel && fuel.generator_on),
      gridUp: grid ? !!grid.active : true,
      activeSource: site.status === 'down' ? 'none' : (active ? active.source : null),
      dark: site.status === 'down',
    },
    markov,
    burnLph: flows && flows.burnLph ? flows.burnLph : assets.gen_burn_lph,
    burnCalibrated: !!(flows && flows.burnLph),
    standingLossLph: flows ? flows.standingLossLph : 0,
    tenants: revenue.n,
    monthlyRevenueK: revenue.r,
    exposurePerDarkHourK,
  };
}

function hashSeed(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function gridFor(ctx, scenarioH, rand) {
  if (scenarioH == null) return markovSimulator(ctx.markov, rand, ctx.state.gridUp);
  const shift = (PROFILES[ctx.assets.grid_profile] || PROFILES.A).shift;
  const sim = scheduleSimulator(ctx.assets.grid_profile === 'N' ? PROFILES.N : scenarioProfile(scenarioH, shift), rand);
  return (ms) => sim(ms, STEP_H);
}

// ----------------------------------------------------------------------------
// Forecast: Monte Carlo over the next `hours`, nobody intervening.
// ----------------------------------------------------------------------------
function forecastSite(ctx, { hours = 72, runs = 200, scenarioH = null, startMs = Date.now() } = {}) {
  const a = { ...ctx.assets, gen_burn_lph: ctx.burnLph, burn_factor: 1 };
  const steps = Math.round(hours / STEP_H);
  const rand = rng(hashSeed(ctx.site.id + ':' + scenarioH + ':' + Math.floor(startMs / 600000)));
  const ttd = [];               // time-to-dark (h) per run, Infinity if never
  const darkStepsByHour = new Array(hours).fill(0);
  let darkStepsTotal = 0, fuelCause = 0, capacityCause = 0, dieselL = 0;
  const fuelOut = [];

  for (let r = 0; r < runs; r++) {
    const st = { fuelL: ctx.state.fuelL, socKwh: ctx.state.socKwh, genOn: ctx.state.genOn };
    const gridUpAt = gridFor(ctx, scenarioH, rand);
    let first = ctx.state.dark ? 0 : Infinity, fuelOutAt = st.fuelL <= 0 ? 0 : Infinity;
    let cloud = 0.55 + rand() * 0.45, lastDay = -1;
    for (let i = 0; i < steps; i++) {
      const t = startMs + i * STEP_MS;
      const hour = localHour(t);
      const day = Math.floor((t / 3600000 + 2) / 24);
      if (day !== lastDay) { cloud = 0.55 + rand() * 0.45; lastDay = day; }
      st.fuelL = Math.max(0, st.fuelL - ctx.standingLossLph * STEP_H);
      const out = step(st, a, gridUpAt(t), a.solar_kw * solarShape(hour) * cloud, STEP_H);
      dieselL += out.burnL;
      if (st.fuelL <= 0 && fuelOutAt === Infinity) fuelOutAt = i * STEP_H;
      if (out.dark) {
        darkStepsTotal++;
        darkStepsByHour[Math.floor(i * STEP_H)]++;
        if (first === Infinity) {
          first = i * STEP_H;
          if (a.gen_kw > 0 && st.fuelL <= 0) fuelCause++; else capacityCause++;
        }
      }
    }
    ttd.push(first);
    fuelOut.push(fuelOutAt);
  }

  ttd.sort((x, y) => x - y);
  fuelOut.sort((x, y) => x - y);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const pDarkBy = (h) => ttd.filter(x => x <= h).length / runs;
  const tolerance = settings.get('dark_risk_tolerance_pct') / 100;
  const survival = [];
  for (let h = 0; h <= hours; h += 1) survival.push({ h, pPowered: 1 - pDarkBy(h) });

  const expectedDarkHours = (darkStepsTotal * STEP_H) / runs;
  const cause = fuelCause + capacityCause === 0 ? null : fuelCause >= capacityCause ? 'fuel' : 'capacity';
  const actBy = q(ttd, tolerance);       // time at which blackout risk reaches tolerance
  return {
    siteId: ctx.site.id,
    horizonHours: hours,
    runs,
    scenario: scenarioH == null ? 'learned' : `${scenarioH} h/day`,
    pDark24h: pDarkBy(24),
    pDark72h: pDarkBy(hours),
    medianTimeToDarkH: Number.isFinite(q(ttd, 0.5)) ? q(ttd, 0.5) : null,
    actByH: Number.isFinite(actBy) ? actBy : null,
    fuelOutMedianH: Number.isFinite(q(fuelOut, 0.5)) ? q(fuelOut, 0.5) : null,
    expectedDarkHours,
    expectedDieselL: dieselL / runs,
    cause,
    exposureK: expectedDarkHours * ctx.exposurePerDarkHourK,
    survival,
    darkProbabilityByHour: darkStepsByHour.map(n => n / runs / (1 / STEP_H)),
  };
}

function riskLevel(f, ctx) {
  if (ctx.state.dark) return 'dark';
  if (f.pDark24h >= 0.5) return 'critical';
  if (f.pDark24h >= 0.15 || f.pDark72h >= 0.5) return 'high';
  if (f.pDark72h >= 0.15) return 'watch';
  return 'ok';
}

function summarise(ctx, f) {
  return {
    siteId: ctx.site.id, name: ctx.site.name, region: ctx.site.region, status: ctx.site.status,
    latitude: ctx.site.latitude, longitude: ctx.site.longitude, simulated: !!ctx.site.simulated,
    risk: riskLevel(f, ctx),
    state: {
      activeSource: ctx.state.activeSource, gridUp: ctx.state.gridUp, genOn: ctx.state.genOn,
      fuelPct: ctx.state.fuelPct, fuelL: ctx.state.fuelL, socPct: ctx.state.socPct,
    },
    assets: ctx.assets,
    burnLph: ctx.burnLph, burnCalibrated: ctx.burnCalibrated, standingLossLph: ctx.standingLossLph,
    gridAvailability14d: ctx.markov.availability,
    tenants: ctx.tenants, monthlyRevenueK: ctx.monthlyRevenueK, exposurePerDarkHourK: ctx.exposurePerDarkHourK,
    forecast: f,
  };
}

function fleetRunway({ scenarioH = null } = {}) {
  return cached(`runway:${scenarioH}`, 20000, () => {
    const t0 = Date.now();
    const sites = db.all('SELECT id FROM sites ORDER BY id');
    const items = [];
    for (const { id } of sites) {
      const ctx = siteContext(id);
      if (!ctx || !ctx.assets) continue;
      items.push(summarise(ctx, forecastSite(ctx, { scenarioH })));
    }
    const order = { dark: 0, critical: 1, high: 2, watch: 3, ok: 4 };
    items.sort((x, y) => order[x.risk] - order[y.risk] || y.forecast.pDark24h - x.forecast.pDark24h);
    const fleet = {
      sites: items.length,
      darkNow: items.filter(i => i.risk === 'dark').length,
      atRisk24h: items.filter(i => i.risk !== 'dark' && i.forecast.pDark24h >= 0.15).length,
      expectedDarkHours72h: items.reduce((s, i) => s + i.forecast.expectedDarkHours, 0),
      exposureK72h: items.reduce((s, i) => s + i.forecast.exposureK, 0),
      onGrid: items.filter(i => i.state.activeSource === 'grid').length,
      onBackup: items.filter(i => ['battery', 'generator', 'solar'].includes(i.state.activeSource)).length,
    };
    return { generatedAt: new Date().toISOString(), scenario: scenarioH == null ? 'learned' : `${scenarioH} h/day`, computeMs: Date.now() - t0, fleet, sites: items };
  });
}

function siteForecast(siteId, { scenarioH = null } = {}) {
  const ctx = siteContext(siteId);
  if (!ctx || !ctx.assets) return null;
  const f = forecastSite(ctx, { scenarioH, runs: 300 });
  return { ...summarise(ctx, f), markov: ctx.markov };
}

// ----------------------------------------------------------------------------
// Action queue: ranked, deadline-driven, valued in Kwacha.
// ----------------------------------------------------------------------------
function fmtDeadline(h) {
  const t = new Date(Date.now() + h * 3600000);
  return t.toISOString();
}

function actionQueue() {
  const runway = fleetRunway();
  const actions = [];
  const sev = { critical: 0, high: 1, medium: 2 };

  for (const s of runway.sites) {
    const f = s.forecast;
    if (s.risk === 'dark') {
      const needL = s.assets.gen_kw > 0 ? Math.round(Math.max(0, s.assets.tank_l * 0.95 - (s.state.fuelL || 0))) : null;
      actions.push({
        id: `restore:${s.siteId}`, kind: 'restore', priority: 'critical', siteId: s.siteId, siteName: s.name,
        title: `Restore power at ${s.name}`,
        detail: s.assets.gen_kw > 0 && (s.state.fuelL || 0) < 5
          ? `Site is dark and the generator is out of fuel. Dispatch ${needL} L now; tenants are off air.`
          : `Site is dark with no backup able to carry the load. Send a mobile generator.`,
        deadline: new Date().toISOString(), valueK: s.exposurePerDarkHourK * Math.max(4, s.assets.refuel_lead_h), litres: needL,
        basis: `Every dark hour costs ~K${Math.round(s.exposurePerDarkHourK).toLocaleString()} in SLA credits (${s.tenants} tenant${s.tenants === 1 ? '' : 's'}).`,
      });
      continue;
    }
    if (f.pDark72h >= 0.15 && f.cause === 'fuel') {
      const lead = s.assets.refuel_lead_h;
      const actBy = f.actByH ?? f.medianTimeToDarkH ?? 72;
      const dispatchBy = Math.max(0, actBy - lead);
      const needL = Math.round(Math.max(0, s.assets.tank_l * 0.95 - s.state.fuelL));
      actions.push({
        id: `refuel:${s.siteId}`, kind: 'refuel',
        priority: f.pDark24h >= 0.5 || dispatchBy < 2 ? 'critical' : f.pDark24h >= 0.15 || dispatchBy < 12 ? 'high' : 'medium',
        siteId: s.siteId, siteName: s.name,
        title: `Refuel ${s.name}: ${needL} L`,
        detail: `${Math.round(f.pDark72h * 100)}% chance of blackout within 72 h (median ${f.medianTimeToDarkH != null ? f.medianTimeToDarkH.toFixed(0) + ' h' : '>72 h'}). Typical delivery lead time is ${lead} h, so the order must go out ${dispatchBy < 1 ? 'now' : 'within ' + dispatchBy.toFixed(0) + ' h'}.`,
        deadline: fmtDeadline(dispatchBy), valueK: f.exposureK, litres: needL,
        basis: `Avoids ~${f.expectedDarkHours.toFixed(1)} expected dark hours × K${Math.round(s.exposurePerDarkHourK).toLocaleString()}/h.`,
      });
    } else if (f.pDark72h >= 0.15 && f.cause === 'capacity') {
      actions.push({
        id: `capacity:${s.siteId}`, kind: 'capacity', priority: f.pDark24h >= 0.5 ? 'critical' : 'high',
        siteId: s.siteId, siteName: s.name,
        title: `Pre-position backup at ${s.name}`,
        detail: `${Math.round(f.pDark72h * 100)}% chance of blackout within 72 h because battery/backup cannot cover the expected outage blocks (fuel is not the constraint). Pre-position a mobile generator and add to the upgrade plan.`,
        deadline: fmtDeadline(Math.max(0, (f.actByH ?? 24) - 2)), valueK: f.exposureK, litres: null,
        basis: `~${f.expectedDarkHours.toFixed(1)} expected dark hours in 72 h.`,
      });
    }
  }

  // Open security/safety alarms are actions too.
  const alarms = db.all(`SELECT a.*, s.name AS site_name FROM alerts a JOIN sites s ON s.id = a.site_id
                          WHERE a.status = 'new' AND a.type IN ('fuel_theft','intrusion','unauthorized_access','smoke')
                          ORDER BY a.created_at DESC LIMIT 20`);
  const price = settings.get('diesel_price_k_per_l');
  for (const al of alarms) {
    let litres = null;
    try { litres = JSON.parse(al.source_data || '{}').litres ?? null; } catch { /* ignore */ }
    actions.push({
      id: `alarm:${al.id}`, kind: 'alarm', priority: 'critical', siteId: al.site_id, siteName: al.site_name, alertId: al.id,
      title: { fuel_theft: 'Investigate fuel loss', intrusion: 'Respond to intrusion', unauthorized_access: 'Verify site access', smoke: 'Fire response' }[al.type] + ` at ${al.site_name}`,
      detail: al.message, deadline: db.normalizeTs(db.tsToMs(al.created_at) + 30 * 60000).replace(' ', 'T') + 'Z',
      valueK: litres ? litres * price : null, litres,
      basis: litres ? `${litres} L × K${price}/L diesel` : 'Safety and asset protection',
    });
  }

  actions.sort((x, y) => sev[x.priority] - sev[y.priority] || Date.parse(x.deadline) - Date.parse(y.deadline));
  return {
    generatedAt: new Date().toISOString(),
    totalValueK: actions.reduce((s, a) => s + (a.valueK || 0), 0),
    actions,
  };
}

// ----------------------------------------------------------------------------
// Redundancy planner: monthly projection with refuel policy, per upgrade option.
// ----------------------------------------------------------------------------
const MAX_PAYBACK_MONTHS = 48;
const OPTIONS = [
  { key: 'battery', label: '+10 kWh battery', battery_kwh: 10, solar_kw: 0 },
  { key: 'solar', label: '+4 kWp solar', battery_kwh: 0, solar_kw: 4 },
  { key: 'hybrid', label: '+4 kWp solar & +10 kWh battery', battery_kwh: 10, solar_kw: 4 },
];

function simulateMonth(ctx, assets, { scenarioH, days = 30, runs = 16 }) {
  const a = { ...assets, gen_burn_lph: ctx.burnLph, burn_factor: 1 };
  const steps = Math.round((days * 24) / STEP_H);
  const trigger = settings.get('refuel_trigger_pct') / 100;
  const rand = rng(hashSeed(ctx.site.id + ':plan:' + scenarioH));
  let darkSteps = 0, diesel = 0;
  const start = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  for (let r = 0; r < runs; r++) {
    const st = { fuelL: a.tank_l * 0.9, socKwh: a.battery_kwh, genOn: false };
    const gridUpAt = gridFor(ctx, scenarioH, rand);
    let deliveryAt = null, cloud = 1, lastDay = -1;
    for (let i = 0; i < steps; i++) {
      const t = start + i * STEP_MS;
      const day = Math.floor((t / 3600000 + 2) / 24);
      if (day !== lastDay) { cloud = 0.55 + rand() * 0.45; lastDay = day; }
      if (a.gen_kw > 0 && deliveryAt == null && st.fuelL < a.tank_l * trigger) deliveryAt = t + a.refuel_lead_h * 3600000 * (0.75 + rand() * 0.5);
      if (deliveryAt != null && t >= deliveryAt) { st.fuelL = a.tank_l * 0.95; deliveryAt = null; }
      st.fuelL = Math.max(0, st.fuelL - ctx.standingLossLph * STEP_H);
      const out = step(st, a, gridUpAt(t), a.solar_kw * solarShape(localHour(t)) * cloud, STEP_H);
      diesel += out.burnL;
      if (out.dark) darkSteps++;
    }
  }
  return { darkHours: (darkSteps * STEP_H) / runs, dieselL: diesel / runs };
}

function planUpgrades({ scenarioH = null, budgetK = 1500000 } = {}) {
  return cached(`plan:${scenarioH}:${budgetK}`, 60000, () => {
    const t0 = Date.now();
    const price = settings.get('diesel_price_k_per_l');
    const battK = settings.get('battery_cost_k_per_kwh');
    const solarK = settings.get('solar_cost_k_per_kw');
    const sites = [];
    for (const { id } of db.all('SELECT id FROM sites ORDER BY id')) {
      const ctx = siteContext(id);
      if (!ctx || !ctx.assets) continue;
      const base = simulateMonth(ctx, ctx.assets, { scenarioH });
      const options = OPTIONS.map(o => {
        const assets = { ...ctx.assets, battery_kwh: ctx.assets.battery_kwh + o.battery_kwh, solar_kw: ctx.assets.solar_kw + o.solar_kw };
        const sim = simulateMonth(ctx, assets, { scenarioH });
        const capexK = o.battery_kwh * battK + o.solar_kw * solarK;
        const avoidedDarkH = Math.max(0, base.darkHours - sim.darkHours);
        const dieselSavedL = base.dieselL - sim.dieselL;
        const monthlyBenefitK = avoidedDarkH * ctx.exposurePerDarkHourK + dieselSavedL * price;
        return {
          key: o.key, label: o.label, capexK, darkHours: sim.darkHours, avoidedDarkH, dieselSavedL, monthlyBenefitK,
          paybackMonths: monthlyBenefitK > 0 ? capexK / monthlyBenefitK : null,
          benefitPerK: capexK > 0 ? monthlyBenefitK / capexK : 0,
        };
      });
      // Recommend only upgrades that pay back within MAX_PAYBACK_MONTHS.
      const best = options.filter(o => o.monthlyBenefitK > 0 && o.paybackMonths <= MAX_PAYBACK_MONTHS).sort((x, y) => y.benefitPerK - x.benefitPerK)[0] || null;
      sites.push({
        siteId: id, name: ctx.site.name, region: ctx.site.region,
        current: { battery_kwh: ctx.assets.battery_kwh, solar_kw: ctx.assets.solar_kw, gen_kw: ctx.assets.gen_kw, tank_l: ctx.assets.tank_l, grid_profile: ctx.assets.grid_profile },
        exposurePerDarkHourK: ctx.exposurePerDarkHourK,
        baseline: { darkHours: base.darkHours, dieselL: base.dieselL, availabilityPct: 100 * (1 - base.darkHours / (30 * 24)) },
        options, best,
      });
    }

    // Greedy selection by benefit per Kwacha within budget.
    const ranked = sites.filter(s => s.best).sort((x, y) => y.best.benefitPerK - x.best.benefitPerK);
    let spent = 0;
    const plan = [];
    for (const s of ranked) {
      const fits = spent + s.best.capexK <= budgetK;
      if (fits) spent += s.best.capexK;
      plan.push({ siteId: s.siteId, name: s.name, option: s.best, funded: fits });
    }
    const funded = plan.filter(p => p.funded);
    const darkBefore = sites.reduce((acc, s) => acc + s.baseline.darkHours, 0);
    const darkAfter = darkBefore - funded.reduce((acc, p) => acc + p.option.avoidedDarkH, 0);
    const monthlyBenefitK = funded.reduce((acc, p) => acc + p.option.monthlyBenefitK, 0);
    return {
      generatedAt: new Date().toISOString(),
      scenario: scenarioH == null ? 'learned from last 14 days' : `${scenarioH} h/day load-shedding`,
      scenarioH, budgetK, computeMs: Date.now() - t0,
      assumptions: { dieselPriceK: price, batteryCostKPerKwh: battK, solarCostKPerKw: solarK, slaCreditMultiplier: settings.get('sla_credit_multiplier'), refuelTriggerPct: settings.get('refuel_trigger_pct') },
      fleet: {
        darkHoursPerMonthBefore: darkBefore, darkHoursPerMonthAfter: darkAfter,
        capexK: spent, monthlyBenefitK, paybackMonths: monthlyBenefitK > 0 ? spent / monthlyBenefitK : null,
        sitesFunded: funded.length,
      },
      plan, sites,
    };
  });
}

module.exports = { siteContext, forecastSite, fleetRunway, siteForecast, actionQueue, planUpgrades, invalidate, OPTIONS };
