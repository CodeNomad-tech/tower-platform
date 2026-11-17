'use strict';
/**
 * Generates SIMULATED operating history for the demo fleet by running the
 * site power model (engine/powerModel.js) forward over the last N days at
 * 15-minute resolution, under each site's load-shedding profile.
 *
 * Nothing here is random noise painted onto a chart. Outages, generator runs,
 * fuel drain, dark periods (and therefore SLA breaches) are consequences of
 * the physics model + the site's equipment + its grid profile. Injected
 * anomalies (theft, siphoning, generator wear, intrusion) are listed in
 * db/catalog.js and documented in docs/DEMO_SCRIPT.md.
 *
 * Runs once, on first boot in demo mode, inside a single transaction.
 */

const db = require('./index');
const { step, rng, localHour, solarShape } = require('../engine/powerModel');
const { PROFILES, scheduleSimulator, STEP_H } = require('../engine/gridModel');

const STEP_MS = STEP_H * 3600000;

function generateHistory(sites, days, { adminUserId = null, seed = 20261117 } = {}) {
  const end = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  const start = end - days * 86400000;
  const finalStates = {};

  const ins = {
    power: 'INSERT INTO power_readings (site_id, source, active, voltage, output_watts, ts) VALUES (?, ?, ?, ?, ?, ?)',
    fuel: 'INSERT INTO fuel_readings (site_id, level_pct, generator_on, ts) VALUES (?, ?, ?, ?)',
    batt: 'INSERT INTO battery_readings (site_id, soc_pct, voltage, ts) VALUES (?, ?, ?, ?)',
    env: 'INSERT INTO env_readings (site_id, temperature_c, smoke_detected, door_open, motion_detected, ts) VALUES (?, ?, 0, ?, ?, ?)',
    status: 'INSERT INTO status_log (site_id, status, ts) VALUES (?, ?, ?)',
    gen: 'INSERT INTO generator_runtime_log (site_id, event, ts) VALUES (?, ?, ?)',
    sw: 'INSERT INTO power_switch_events (site_id, from_source, to_source, reason, ts) VALUES (?, ?, ?, ?, ?)',
    deliv: 'INSERT INTO fuel_deliveries (site_id, litres, supplier, reference, recorded_by, ts) VALUES (?, ?, ?, ?, ?, ?)',
    alert: `INSERT INTO alerts (site_id, type, severity, message, status, source_data, created_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by, resolution_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sec: 'INSERT INTO security_events (site_id, event_type, source, confidence, ts) VALUES (?, ?, ?, ?, ?)',
  };

  db.tx(() => {
    sites.forEach((site, idx) => {
      const a = { ...site.assets };
      const rand = rng(seed + idx * 7919);
      const profile = PROFILES[a.grid_profile] || PROFILES.A;
      const gridUpAt = scheduleSimulator(profile, rand);
      const st = { fuelL: a.tank_l * (0.55 + rand() * 0.35), socKwh: a.battery_kwh, genOn: false };
      const anomalies = site.anomalies || {};
      const totalDays = days;
      // Refuel cadence phased so that the last delivery happened `lastAgoDays` ago.
      const endDayIdx = Math.floor(end / 86400000);
      const deliveryDayMod = ((endDayIdx - site.refuel.lastAgoDays) % site.refuel.everyDays + site.refuel.everyDays) % site.refuel.everyDays;
      let deliveredToday = -1;
      let lastSource = null;
      let darkSince = null;
      let status = 'online';
      let lowFuelOpen = false;
      let tempC = 24;
      let cloud = 1;

      db.run(ins.status, [site.id, 'online', db.toSqliteTs(start - 1000)]);

      for (let t = start; t < end; t += STEP_MS) {
        const ts = db.toSqliteTs(t);
        const hour = localHour(t);
        const dayIdx = Math.floor(t / 86400000);
        const dayFrac = (t - start) / (end - start);
        if (Math.abs(hour - 0) < 1e-6 || t === start) cloud = 0.55 + rand() * 0.45; // daily cloudiness

        // --- scheduled refuel delivery (mid-morning on delivery days) ---
        if (a.gen_kw > 0 && a.tank_l > 0 && dayIdx % site.refuel.everyDays === deliveryDayMod && deliveredToday !== dayIdx && hour >= 10) {
          const litres = Math.round(Math.max(0, a.tank_l * 0.95 - st.fuelL));
          if (litres > 20) {
            st.fuelL += litres;
            db.run(ins.deliv, [site.id, litres, 'Demo Fuel Logistics', `DN-${site.id}-${dayIdx}`, adminUserId, ts]);
          }
          deliveredToday = dayIdx;
        }

        // --- anomalies ---
        if (anomalies.burnDegradation) {
          const d = anomalies.burnDegradation;
          a.burn_factor = d.from + (d.to - d.from) * dayFrac;
        }
        let theftNow = 0;
        if (anomalies.siphon && hour >= 1 && hour < 1.25 && !st.genOn) {
          const [lo, hi] = anomalies.siphon.litresPerNight;
          theftNow = lo + rand() * (hi - lo);
        }
        if (anomalies.abruptTheft) {
          const at = end - anomalies.abruptTheft.daysAgo * 86400000;
          const atDay = Math.floor(at / 86400000);
          if (dayIdx === atDay && Math.abs(hour - anomalies.abruptTheft.hourLocal) < STEP_H / 2 + 1e-9) theftNow = anomalies.abruptTheft.litres;
        }
        if (theftNow > 0) {
          const before = st.fuelL;
          st.fuelL = Math.max(0, st.fuelL - theftNow);
          if (theftNow >= 50) {
            const created = ts;
            const ack = db.toSqliteTs(t + 22 * 60000);
            const res = db.toSqliteTs(t + 9 * 3600000);
            db.run(ins.alert, [site.id, 'fuel_theft', 'critical',
              `Fuel dropped ${Math.round(before - st.fuelL)} L (${((before - st.fuelL) / a.tank_l * 100).toFixed(0)}% of tank) in 15 min with the generator OFF: possible theft`,
              'resolved', JSON.stringify({ litres: Math.round(before - st.fuelL) }), created, ack, adminUserId, res, adminUserId,
              'Guard confirmed tank cap forced; police report filed (simulated).']);
          }
        }

        // --- power model ---
        const gridUp = gridUpAt(t);
        const solarKw = a.solar_kw * solarShape(hour) * cloud;
        const r = step(st, a, gridUp, solarKw, STEP_H);

        if (r.genStarted) db.run(ins.gen, [site.id, 'start', ts]);
        // If the generator burned fuel this step and then stopped, it stopped at the END of the step.
        if (r.genStopped) db.run(ins.gen, [site.id, 'stop', r.burnL > 0 ? db.toSqliteTs(t + STEP_MS) : ts]);

        const src = r.dark ? 'none' : r.source;
        if (src !== lastSource) {
          if (lastSource !== null) db.run(ins.sw, [site.id, lastSource, src, src === 'none' ? 'all sources exhausted' : 'automatic', ts]);
          lastSource = src;
        }

        const watts = { grid: r.gridKw, solar: r.solarKw, battery: r.batteryKw, generator: r.genKw };
        for (const s of ['grid', 'solar', 'battery', 'generator']) {
          const active = r.source === s ? 1 : 0;
          const volt = s === 'grid' ? (gridUp ? 220 + (rand() * 8 - 4) : 0) : s === 'battery' ? 48 + (st.socKwh / Math.max(1, a.battery_kwh)) * 4 : active ? 220 : 0;
          db.run(ins.power, [site.id, s, active, Math.round(volt * 10) / 10, Math.round(watts[s] * 1000), ts]);
        }
        if (a.tank_l > 0) db.run(ins.fuel, [site.id, Math.round((st.fuelL / a.tank_l) * 1000) / 10, st.genOn ? 1 : 0, ts]);
        if (a.battery_kwh > 0) db.run(ins.batt, [site.id, Math.round((st.socKwh / a.battery_kwh) * 1000) / 10, 48 + (st.socKwh / a.battery_kwh) * 4, ts]);

        // Environment: ambient diurnal cycle + generator heat, hourly
        if (Math.abs(hour % 1) < 1e-6) {
          const ambient = 21 + 9 * Math.max(0, Math.sin((Math.PI * (hour - 8)) / 14)) + (site.region === 'Southern' ? 3 : 0);
          tempC += ((ambient + (st.genOn ? 6 : 0)) - tempC) * 0.6 + (rand() - 0.5);
          const door = rand() < 0.01 ? 1 : 0;
          db.run(ins.env, [site.id, Math.round(tempC * 10) / 10, door, door ? 1 : 0, ts]);
        }

        // Status + site-down alerts (auto-resolved when power returns)
        const newStatus = r.dark ? 'down' : 'online';
        if (newStatus !== status) {
          db.run(ins.status, [site.id, newStatus, ts]);
          if (newStatus === 'down') darkSince = t;
          else if (darkSince != null) {
            const ackMin = 6 + rand() * 35;
            const acked = darkSince + ackMin * 60000 < t;
            db.run(ins.alert, [site.id, 'site_down', 'critical',
              `Site lost all power: grid off, ${a.gen_kw > 0 ? (st.fuelL <= 1 ? 'generator out of fuel' : 'generator unavailable') : 'no generator'}, battery exhausted`,
              'resolved', '{}', db.toSqliteTs(darkSince), acked ? db.toSqliteTs(darkSince + ackMin * 60000) : null, acked ? adminUserId : null,
              ts, null, 'Auto-resolved: power restored']);
            darkSince = null;
          }
          status = newStatus;
        }

        // Low fuel alert lifecycle
        const pct = a.tank_l > 0 ? st.fuelL / a.tank_l * 100 : 100;
        if (pct <= 20 && !lowFuelOpen && a.gen_kw > 0) { lowFuelOpen = { t, pct }; }
        if (lowFuelOpen && pct > 50) {
          const ackMin = 10 + rand() * 50;
          db.run(ins.alert, [site.id, 'low_fuel', lowFuelOpen.pct <= 10 ? 'critical' : 'warning',
            `Fuel at ${lowFuelOpen.pct.toFixed(0)}% (${Math.round(lowFuelOpen.pct * a.tank_l / 100)} L), threshold 20%`, 'resolved', '{}',
            db.toSqliteTs(lowFuelOpen.t), db.toSqliteTs(lowFuelOpen.t + ackMin * 60000), adminUserId, ts, adminUserId, 'Refuelled']);
          lowFuelOpen = false;
        }

        if (anomalies.intrusion) {
          const at = end - anomalies.intrusion.daysAgo * 86400000;
          if (Math.floor(at / 86400000) === dayIdx && Math.abs(hour - anomalies.intrusion.hourLocal) < STEP_H / 2 + 1e-9) {
            db.run(ins.sec, [site.id, 'intrusion', 'camera', 0.91, ts]);
            db.run(ins.alert, [site.id, 'intrusion', 'critical', 'Intrusion detected via camera (confidence 0.91)', 'resolved', '{}',
              ts, db.toSqliteTs(t + 4 * 60000), adminUserId, db.toSqliteTs(t + 75 * 60000), adminUserId, 'Security patrol attended; perimeter fence cut repaired (simulated).']);
          }
        }
      }

      // Leave still-open conditions open so the live console starts truthful.
      if (darkSince != null) {
        db.run(ins.alert, [site.id, 'site_down', 'critical', 'Site lost all power: battery exhausted and no backup available', 'new', '{}', db.toSqliteTs(darkSince), null, null, null, null, null]);
      }
      if (lowFuelOpen) {
        db.run(ins.alert, [site.id, 'low_fuel', lowFuelOpen.pct <= 10 ? 'critical' : 'warning',
          `Fuel at ${lowFuelOpen.pct.toFixed(0)}% (${Math.round(lowFuelOpen.pct * a.tank_l / 100)} L), threshold 20%`, 'new', '{}', db.toSqliteTs(lowFuelOpen.t), null, null, null, null, null]);
      }
      db.run('UPDATE sites SET status = ?, last_heartbeat = ? WHERE id = ?', [status, db.toSqliteTs(end), site.id]);
      finalStates[site.id] = { ...st, burn_factor: a.burn_factor };
    });
  });
  return { start, end, finalStates };
}

module.exports = { generateHistory };
