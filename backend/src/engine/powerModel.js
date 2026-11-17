'use strict';
/**
 * Site power model ("digital twin") — a 15-minute energy balance for one tower.
 *
 * Supply priority mirrors a typical hybrid tower controller:
 *   grid  →  solar  →  battery  →  diesel generator  →  DARK
 * The generator starts when the battery falls to GEN_START_SOC (immediately
 * if there is no battery) and stops once the battery is back to GEN_STOP_SOC,
 * or when grid returns. While running it serves the load and charges the battery.
 *
 * This single model is used for three things, so they are consistent by construction:
 *   1. generating the simulated 30-day history (db/history.js)
 *   2. the live fleet simulator (simulators/fleetSimulator.js)
 *   3. forecasting and upgrade planning (engine/resilience.js)
 *
 * It is deliberately simple and explainable. Known simplifications (documented
 * in docs/RESILIENCE_ENGINE.md): constant load, constant generator burn rate,
 * no battery ageing/temperature derating, no rectifier losses.
 */

const config = require('../config');

const GEN_START_SOC = 0.30;
const GEN_STOP_SOC = 0.90;

// Seeded PRNG (mulberry32) so simulations are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localHour(ms) {
  const h = (ms / 3600000 + config.LOCAL_UTC_OFFSET_H) % 24;
  return h < 0 ? h + 24 : h;
}

// Clear-sky PV shape for Zambia (~06:00–18:00 local), 0..1 of installed peak.
function solarShape(hourLocal) {
  if (hourLocal <= 6 || hourLocal >= 18) return 0;
  return Math.sin((Math.PI * (hourLocal - 6)) / 12);
}

function chargeRateKw(a) {
  return a.battery_kwh > 0 ? Math.max(1, a.battery_kwh * 0.25) : 0;
}

/**
 * Advances one site by dtH hours. Mutates and returns `st`.
 * st: { fuelL, socKwh, genOn }
 * a:  site_assets row (+ optional burn_factor for a degrading generator)
 * Returns { source, dark, gridKw, solarKw, batteryKw, genKw, burnL, genStarted, genStopped }.
 */
function step(st, a, gridUp, solarAvailKw, dtH) {
  const load = a.load_kw;
  const cap = a.battery_kwh;
  const chargeKw = chargeRateKw(a);
  const out = { source: 'none', dark: false, gridKw: 0, solarKw: 0, batteryKw: 0, genKw: 0, burnL: 0, genStarted: false, genStopped: false };
  const wasOn = st.genOn;

  const charge = (kwAvail) => {
    if (cap <= 0) return;
    const kw = Math.min(kwAvail, chargeKw, (cap - st.socKwh) / dtH);
    if (kw > 0) st.socKwh += kw * dtH;
  };

  if (gridUp) {
    out.source = 'grid';
    out.gridKw = load;
    out.solarKw = Math.min(solarAvailKw, load);
    charge(chargeKw);
    st.genOn = false;
  } else if (solarAvailKw >= load) {
    out.source = 'solar';
    out.solarKw = solarAvailKw;
    charge(solarAvailKw - load);
    st.genOn = false;
  } else {
    const deficit = load - solarAvailKw;
    out.solarKw = solarAvailKw;
    const canRunGen = a.gen_kw > 0 && st.fuelL > 0;
    if (canRunGen && (st.genOn || st.socKwh <= cap * GEN_START_SOC + 1e-9)) st.genOn = true;
    if (!canRunGen) st.genOn = false;

    let served = false;
    if (st.genOn) {
      const need = a.gen_burn_lph * (a.burn_factor || 1) * dtH;
      const burn = Math.min(need, st.fuelL);
      st.fuelL -= burn;
      out.burnL = burn;
      if (burn >= need - 1e-9) {
        out.source = 'generator';
        out.genKw = deficit;
        charge(Math.max(0, a.gen_kw - deficit));
        served = true;
        if (cap > 0 && st.socKwh >= cap * GEN_STOP_SOC) st.genOn = false;
      } else {
        st.genOn = false; // ran dry part-way through the interval
      }
    }
    if (!served) {
      const needKwh = deficit * dtH;
      if (st.socKwh >= needKwh) {
        st.socKwh -= needKwh;
        out.source = 'battery';
        out.batteryKw = deficit;
      } else {
        st.socKwh = 0;
        out.dark = true;
        out.source = 'none';
      }
    }
  }
  out.genStarted = !wasOn && st.genOn;
  out.genStopped = wasOn && !st.genOn;
  return out;
}

module.exports = { step, rng, localHour, solarShape, GEN_START_SOC, GEN_STOP_SOC };
