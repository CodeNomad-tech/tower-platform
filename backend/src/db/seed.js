'use strict';
/**
 * Idempotent seed script — creates demo sites, an admin user, and sample
 * tenants if they don't already exist. Run automatically on first boot.
 */

const db = require('./index');
const { hashPassword } = require('../auth/auth');

const DEMO_SITES = [
  { id: 'site-001', name: 'Lusaka Central Tower', region: 'Lusaka', latitude: -15.3875, longitude: 28.3228, capacity: 6 },
  { id: 'site-002', name: 'Ndola Industrial Site', region: 'Copperbelt', latitude: -12.9587, longitude: 28.6366, capacity: 5 },
  { id: 'site-003', name: 'Livingstone Border Relay', region: 'Southern', latitude: -17.8419, longitude: 25.8544, capacity: 4 },
  { id: 'site-004', name: 'Kitwe Highway Node', region: 'Copperbelt', latitude: -12.8024, longitude: 28.2132, capacity: 5 },
];

function seed() {
  for (const site of DEMO_SITES) {
    const exists = db.get('SELECT id FROM sites WHERE id = ?', [site.id]);
    if (!exists) {
      db.run(
        'INSERT INTO sites (id, name, region, latitude, longitude, capacity, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [site.id, site.name, site.region, site.latitude, site.longitude, site.capacity, 'unknown']
      );
      db.run('INSERT INTO sla_thresholds (site_id, target_uptime_pct) VALUES (?, 99.5)', [site.id]);
      db.run('INSERT INTO status_log (site_id, status) VALUES (?, \'online\')', [site.id]);
    }
  }

  // Sample tenants (commercial intelligence module)
  const tenantCount = db.get('SELECT COUNT(*) as c FROM tenants').c;
  if (tenantCount === 0) {
    const sample = [
      ['site-001', 'MTN Zambia', 4200], ['site-001', 'Airtel Zambia', 3800], ['site-001', 'Zamtel', 3100],
      ['site-002', 'MTN Zambia', 4200], ['site-002', 'Airtel Zambia', 3800],
      ['site-003', 'Zamtel', 3100],
      ['site-004', 'MTN Zambia', 4200], ['site-004', 'Airtel Zambia', 3800], ['site-004', 'Zamtel', 3100],
    ];
    for (const [siteId, name, value] of sample) {
      db.run('INSERT INTO tenants (site_id, name, contract_value_monthly) VALUES (?, ?, ?)', [siteId, name, value]);
    }
  }

  // Default admin user for demo purposes — CHANGE THIS PASSWORD before any real deployment
  const admin = db.get('SELECT id FROM users WHERE email = ?', ['admin@towerplatform.demo']);
  if (!admin) {
    const { hash, salt } = hashPassword('ChangeMe123!');
    db.run(
      'INSERT INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, ?)',
      ['admin@towerplatform.demo', hash, salt, 'admin']
    );
    console.log('[seed] created demo admin user: admin@towerplatform.demo / ChangeMe123!  (change this before real deployment)');
  }
}

if (require.main === module) {
  seed();
  console.log('[seed] done');
}

module.exports = { seed, DEMO_SITES };
