'use strict';
/**
 * Grid availability models.
 *
 * 1. Load-shedding schedules (used to SIMULATE the demo fleet's history and
 *    live behaviour, and for planner "what-if" scenarios). Modelled on the
 *    shape of ZESCO's 2024 schedules: rotating daily blocks per load group.
 *    The demo groups are illustrative, not ZESCO's actual published groups.
 *
 * 2. A learned 2-state Markov chain per hour of day (used to FORECAST).
 *    It is estimated from each site's own telemetry: for each local hour h,
 *    P(grid fails | it was up) and P(grid returns | it was down). This
 *    captures the time-of-day structure of load-shedding without being told
 *    the schedule.
 */

const db = require('../db');
const { localHour } = require('./powerModel');

const STEP_H = 0.25;

// Illustrative demo load-shedding groups: daily outage hours and block layout.
const PROFILES = {
  A: { label: 'Urban feeder (~8 h/day)', hours: 8, blocks: 2, shift: 0, faultPerH: 0.004 },
  B: { label: 'Urban feeder (~12 h/day)', hours: 12, blocks: 2, shift: 3, faultPerH: 0.006 },
  C: { label: 'Rural feeder (~6 h/day + faults)', hours: 6, blocks: 1, shift: 5, faultPerH: 0.02 },
  D: { label: 'Weak rural feeder (~16 h/day)', hours: 16, blocks: 2, shift: 1, faultPerH: 0.02 },
  N: { label: 'Off-grid (no ZESCO supply)', hours: 24, blocks: 1, shift: 0, faultPerH: 0 },
};

/**
 * Deterministic scheduled outage: is the grid scheduled OFF at this instant?
 * `hours` per day split into `blocks` equal blocks spread across the day,
 * rotating by 2 h each day like a rota.
 */
function scheduledOff(ms, { hours, blocks, shift }) {
  if (hours <= 0) return false;
  if (hours >= 24) return true;
  const dayIdx = Math.floor((ms / 3600000 + 2) / 24);
  const h = localHour(ms);
  const blockLen = hours / blocks;
  const spacing = 24 / blocks;
  const rot = (shift + (dayIdx % 4) * 2) % 24;
  for (let b = 0; b < blocks; b++) {
    const start = (rot + b * spacing + 5) % 24; // first block typically starts early morning
    const end = start + blockLen;
    if ((h >= start && h < end) || (end > 24 && h < end - 24)) return true;
  }
  return false;
}

/**
 * Stateful grid simulator for one site: scheduled blocks + random faults.
 * Returns a function (ms) => gridUp, to be called on consecutive steps.
 */
function scheduleSimulator(profile, rand) {
  let faultLeftH = 0;
  return function gridUpAt(ms, dtH = STEP_H) {
    if (faultLeftH > 0) { faultLeftH -= dtH; return false; }
    if (profile.faultPerH && rand() < profile.faultPerH * dtH) {
      faultLeftH = 1 + rand() * 3; // unplanned fault lasting 1–4 h
      return false;
    }
    return !scheduledOff(ms, profile);
  };
}

// Scenario profile for the planner: "what if load-shedding were H hours/day?"
function scenarioProfile(hoursPerDay, groupShift = 0) {
  return { label: `Scenario ${hoursPerDay} h/day`, hours: hoursPerDay, blocks: hoursPerDay > 10 ? 2 : 1, shift: groupShift, faultPerH: 0.005 };
}

/**
 * Learns the hourly Markov chain from a site's grid telemetry over `days`.
 * Telemetry arrives at irregular rates (15-min history, ~10 s live), so it is
 * first resampled to 15-minute buckets.
 */
function learnMarkov(siteId, days = 14) {
  const since = db.toSqliteTs(Date.now() - days * 86400000);
  const rows = db.all(
    `SELECT substr(ts, 1, 14) || printf('%02d', (CAST(substr(ts, 15, 2) AS INTEGER) / 15) * 15) AS bucket,
            MAX(active) AS up
       FROM power_readings
      WHERE site_id = ? AND source = 'grid' AND ts >= ?
      GROUP BY bucket ORDER BY bucket`,
    [siteId, since]
  );
  const fail = new Array(24).fill(0), upN = new Array(24).fill(0);
  const ret = new Array(24).fill(0), downN = new Array(24).fill(0);
  let upSamples = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    const ms = db.tsToMs(cur.bucket + ':00');
    if (ms - db.tsToMs(prev.bucket + ':00') > 20 * 60000) continue; // gap in data
    const h = Math.floor(localHour(ms));
    if (prev.up) { upN[h]++; if (!cur.up) fail[h]++; } else { downN[h]++; if (cur.up) ret[h]++; }
  }
  for (const r of rows) if (r.up) upSamples++;
  // Laplace smoothing keeps probabilities sane for hours with little data.
  const pFail = fail.map((f, h) => (f + 0.05) / (upN[h] + 2));
  const pRestore = ret.map((r, h) => (r + 0.5) / (downN[h] + 2));
  const availability = rows.length ? upSamples / rows.length : null;
  return { pFail, pRestore, samples: rows.length, availability, days };
}

function markovSimulator(markov, rand, initialUp) {
  let up = initialUp;
  return function gridUpAt(ms) {
    const h = Math.floor(localHour(ms));
    if (up) { if (rand() < markov.pFail[h]) up = false; } else if (rand() < markov.pRestore[h]) up = true;
    return up;
  };
}

module.exports = { PROFILES, STEP_H, scheduledOff, scheduleSimulator, scenarioProfile, learnMarkov, markovSimulator };
