'use strict';
/**
 * Demo-mode seed: simulated sites, assets, tenants, SLA targets, a demo admin,
 * and 30 days of simulated history. Idempotent: does nothing if sites exist.
 * In production (DEMO_MODE=false) nothing is seeded and an admin is created
 * with `npm run create-admin`.
 */

const db = require('./index');
const config = require('../config');
const { SITES } = require('./catalog');
const { generateHistory } = require('./history');

function seed({ withHistory = true, log = console.log } = {}) {
  if (!config.DEMO_MODE) return { seeded: false };
  const { hashPassword } = require('../auth/passwords');

  let admin = db.get('SELECT id FROM users WHERE email = ?', [config.DEMO_ADMIN_EMAIL]);
  if (!admin) {
    const { hash, salt } = hashPassword(config.DEMO_ADMIN_PASSWORD);
    const r = db.run('INSERT INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, ?)',
      [config.DEMO_ADMIN_EMAIL, hash, salt, 'admin']);
    admin = { id: Number(r.lastInsertRowid) };
    for (const [email, role] of [['operator@toweriq.demo', 'operator'], ['viewer@toweriq.demo', 'viewer']]) {
      const p = hashPassword(config.DEMO_ADMIN_PASSWORD);
      db.run('INSERT OR IGNORE INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, ?)', [email, p.hash, p.salt, role]);
    }
    log(`[seed] demo users created (admin/operator/viewer @toweriq.demo). Password from DEMO_ADMIN_PASSWORD.`);
  }

  const existing = db.get('SELECT COUNT(*) AS c FROM sites').c;
  if (existing > 0) return { seeded: false };

  db.tx(() => {
    for (const s of SITES) {
      db.run('INSERT INTO sites (id, name, region, latitude, longitude, capacity, status, simulated) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [s.id, s.name, s.region, s.latitude, s.longitude, s.capacity, 'unknown']);
      const a = s.assets;
      db.run(`INSERT INTO site_assets (site_id, load_kw, battery_kwh, solar_kw, tank_l, gen_kw, gen_burn_lph, grid_profile, refuel_lead_h)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, a.load_kw, a.battery_kwh, a.solar_kw, a.tank_l, a.gen_kw, a.gen_burn_lph, a.grid_profile, a.refuel_lead_h]);
      db.run('INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, 99.5)', [s.id]);
      for (const [name, value] of s.tenants) {
        db.run(`INSERT INTO tenants (site_id, name, contract_value_monthly, start_date) VALUES (?, ?, ?, datetime('now', '-400 days'))`, [s.id, name, value]);
      }
    }
  });

  if (withHistory) {
    const t0 = Date.now();
    generateHistory(SITES, config.HISTORY_DAYS, { adminUserId: admin.id });
    log(`[seed] generated ${config.HISTORY_DAYS} days of SIMULATED history for ${SITES.length} sites in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  return { seeded: true };
}

if (require.main === module) {
  seed();
  console.log('[seed] done');
}

module.exports = { seed };
