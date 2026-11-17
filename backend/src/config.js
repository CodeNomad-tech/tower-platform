'use strict';
/**
 * Central runtime configuration. Every value has a safe local-demo default
 * and can be overridden with an environment variable (see .env.example).
 */

const path = require('node:path');

function bool(name, dflt) {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  return !['false', '0', 'no', 'off'].includes(String(v).toLowerCase());
}

module.exports = {
  HTTP_PORT: Number(process.env.PORT) || 3000,
  MQTT_PORT: Number(process.env.MQTT_PORT) || 1883,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/toweriq.db'),

  // DEMO_MODE seeds simulated sites + 30 days of simulated history, runs the
  // fleet simulator and exposes admin-only scenario controls. Everything it
  // produces is labelled as simulated in the API (`/api/meta`) and the UI.
  DEMO_MODE: bool('DEMO_MODE', true),
  RUN_SIMULATOR: bool('RUN_SIMULATOR', bool('DEMO_MODE', true)),
  HISTORY_DAYS: Number(process.env.HISTORY_DAYS) || 30,

  // Demo admin is created only in demo mode. Override the password via env.
  DEMO_ADMIN_EMAIL: process.env.DEMO_ADMIN_EMAIL || 'admin@toweriq.demo',
  DEMO_ADMIN_PASSWORD: process.env.DEMO_ADMIN_PASSWORD || 'ChangeMe123!',

  // Live telemetry cadence of the simulator (real time, not accelerated).
  SIM_TICK_MS: Number(process.env.SIM_TICK_MS) || 10000,

  // Zambia is UTC+2 (CAT) with no daylight saving. Solar output and
  // load-shedding schedules are evaluated in local time.
  LOCAL_UTC_OFFSET_H: Number(process.env.LOCAL_UTC_OFFSET_H ?? 2),

  SESSION_TTL_MS: 12 * 60 * 60 * 1000,
  MAX_BODY_BYTES: 256 * 1024,
};
