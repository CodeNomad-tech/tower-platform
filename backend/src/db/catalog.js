'use strict';
/**
 * SIMULATED DEMO FLEET. Every site, asset figure, tenant contract value and
 * anomaly below is illustrative, chosen to show realistic operating
 * situations. Site names use real Zambian towns, but these are not Infratel
 * sites, and contract values are not real commercial figures. The UI and
 * /api/meta label all of this as simulated.
 *
 * Asset fields map to the site_assets table (see schema.sql).
 * `story` is shown nowhere in the UI. It documents why each site is configured
 * the way it is, so the demo is explainable.
 */

const SITES = [
  {
    id: 'LSK-001', name: 'Lusaka Central', region: 'Lusaka', latitude: -15.4167, longitude: 28.2833, capacity: 6,
    assets: { load_kw: 3.0, battery_kwh: 24, solar_kw: 6, tank_l: 1200, gen_kw: 15, gen_burn_lph: 2.6, grid_profile: 'A', refuel_lead_h: 12 },
    refuel: { everyDays: 14, lastAgoDays: 3 },
    tenants: [['MTN Zambia', 21500], ['Airtel Zambia', 21500], ['Zamtel', 18000], ['FibreLink ISP (demo)', 9500]],
    story: 'Flagship urban hybrid site: well protected, the benchmark.',
  },
  {
    id: 'LSK-014', name: 'Chongwe Ridge', region: 'Lusaka', latitude: -15.33, longitude: 28.68, capacity: 4,
    assets: { load_kw: 2.2, battery_kwh: 10, solar_kw: 0, tank_l: 800, gen_kw: 10, gen_burn_lph: 1.9, grid_profile: 'B', refuel_lead_h: 18 },
    refuel: { everyDays: 12, lastAgoDays: 5 },
    tenants: [['Airtel Zambia', 17500], ['Zamtel', 15000]],
    story: 'Peri-urban, 12 h/day load-shedding, no solar: diesel-heavy.',
  },
  {
    id: 'CEN-003', name: 'Kabwe North', region: 'Central', latitude: -14.44, longitude: 28.45, capacity: 4,
    assets: { load_kw: 2.0, battery_kwh: 10, solar_kw: 3, tank_l: 1000, gen_kw: 10, gen_burn_lph: 1.8, grid_profile: 'B', refuel_lead_h: 24 },
    refuel: { everyDays: 18, lastAgoDays: 6 },
    tenants: [['MTN Zambia', 16500], ['Airtel Zambia', 16500], ['Zamtel', 14000]],
    story: 'Average site with small solar.',
  },
  {
    id: 'CEN-009', name: 'Mkushi Farm Block', region: 'Central', latitude: -13.62, longitude: 29.39, capacity: 3,
    assets: { load_kw: 1.8, battery_kwh: 0, solar_kw: 0, tank_l: 500, gen_kw: 10, gen_burn_lph: 1.7, grid_profile: 'C', refuel_lead_h: 48 },
    refuel: { everyDays: 14, lastAgoDays: 11 },
    tenants: [['MTN Zambia', 14500]],
    story: 'Generator-only backup with no battery, so every grid fault means a cold start.',
  },
  {
    id: 'CPB-002', name: 'Ndola Industrial', region: 'Copperbelt', latitude: -12.96, longitude: 28.64, capacity: 5,
    assets: { load_kw: 2.6, battery_kwh: 15, solar_kw: 3, tank_l: 1000, gen_kw: 12, gen_burn_lph: 2.2, grid_profile: 'A', refuel_lead_h: 12 },
    refuel: { everyDays: 14, lastAgoDays: 8 },
    tenants: [['MTN Zambia', 19000], ['Airtel Zambia', 19000], ['Zamtel', 16000]],
    story: 'Abrupt theft event 6 days ago: 180 L removed overnight with the generator off.',
    anomalies: { abruptTheft: { daysAgo: 6, hourLocal: 2.25, litres: 180 } },
  },
  {
    id: 'CPB-007', name: 'Kitwe Highway', region: 'Copperbelt', latitude: -12.80, longitude: 28.21, capacity: 5,
    assets: { load_kw: 2.8, battery_kwh: 5, solar_kw: 0, tank_l: 300, gen_kw: 12, gen_burn_lph: 2.6, grid_profile: 'B', refuel_lead_h: 12 },
    refuel: { everyDays: 12, lastAgoDays: 9 },
    tenants: [['MTN Zambia', 19000], ['Airtel Zambia', 19000]],
    story: 'Small tank, 12 h/day load-shedding and slow nightly siphoning: runs dry before scheduled deliveries.',
    anomalies: { siphon: { litresPerNight: [10, 16] } },
  },
  {
    id: 'NWP-004', name: 'Solwezi Mine Road', region: 'North-Western', latitude: -12.17, longitude: 26.39, capacity: 4,
    assets: { load_kw: 2.4, battery_kwh: 10, solar_kw: 2, tank_l: 1000, gen_kw: 12, gen_burn_lph: 2.1, grid_profile: 'D', refuel_lead_h: 36 },
    refuel: { everyDays: 12, lastAgoDays: 4 },
    tenants: [['MTN Zambia', 17000], ['Airtel Zambia', 17000], ['Zamtel', 14000]],
    story: 'Weak rural feeder (~16 h/day off). Intrusion event 3 days ago.',
    anomalies: { intrusion: { daysAgo: 3, hourLocal: 23.5 } },
  },
  {
    id: 'NOR-006', name: 'Kasama Hill', region: 'Northern', latitude: -10.21, longitude: 31.18, capacity: 3,
    assets: { load_kw: 2.0, battery_kwh: 5, solar_kw: 0, tank_l: 400, gen_kw: 10, gen_burn_lph: 2.4, grid_profile: 'D', refuel_lead_h: 72 },
    refuel: { everyDays: 21, lastAgoDays: 16 },
    tenants: [['Airtel Zambia', 15500], ['Zamtel', 13500]],
    story: 'Remote, 72 h refuel lead time: low fuel is dangerous because help arrives slowly.',
  },
  {
    id: 'EAS-005', name: 'Chipata Border', region: 'Eastern', latitude: -13.63, longitude: 32.65, capacity: 4,
    assets: { load_kw: 2.2, battery_kwh: 5, solar_kw: 0, tank_l: 1000, gen_kw: 10, gen_burn_lph: 2.0, grid_profile: 'B', refuel_lead_h: 48 },
    refuel: { everyDays: 21, lastAgoDays: 9 },
    tenants: [['MTN Zambia', 16000], ['Airtel Zambia', 16000]],
    story: 'Generator burn rate degrading ~25% over 30 days (injector/air-filter wear pattern).',
    anomalies: { burnDegradation: { from: 1.0, to: 1.25 } },
  },
  {
    id: 'WES-002', name: 'Mongu Plains', region: 'Western', latitude: -15.25, longitude: 23.13, capacity: 3,
    assets: { load_kw: 1.6, battery_kwh: 30, solar_kw: 8, tank_l: 800, gen_kw: 8, gen_burn_lph: 1.6, grid_profile: 'N', refuel_lead_h: 72 },
    refuel: { everyDays: 30, lastAgoDays: 10 },
    tenants: [['Zamtel', 13000], ['Airtel Zambia', 13000]],
    story: 'Off-grid solar hybrid: shows what a well-designed upgrade looks like.',
  },
  {
    id: 'SOU-001', name: 'Livingstone Relay', region: 'Southern', latitude: -17.84, longitude: 25.85, capacity: 4,
    assets: { load_kw: 2.2, battery_kwh: 15, solar_kw: 4, tank_l: 1000, gen_kw: 10, gen_burn_lph: 1.9, grid_profile: 'A', refuel_lead_h: 18 },
    refuel: { everyDays: 18, lastAgoDays: 2 },
    tenants: [['MTN Zambia', 18000], ['Airtel Zambia', 18000], ['Zamtel', 15500]],
    story: 'Tourism corridor, healthy hybrid.',
  },
  {
    id: 'LUA-003', name: 'Mansa Lakeside', region: 'Luapula', latitude: -11.20, longitude: 28.89, capacity: 3,
    assets: { load_kw: 1.8, battery_kwh: 8, solar_kw: 0, tank_l: 0, gen_kw: 0, gen_burn_lph: 0, grid_profile: 'C', refuel_lead_h: 48 },
    refuel: { everyDays: 30, lastAgoDays: 30 },
    tenants: [['MTN Zambia', 14000]],
    story: 'Battery-only backup (generator removed after alternator theft). Goes dark in long outage blocks: capacity-limited, not fuel-limited. Under-tenanted.',
  },
];

module.exports = { SITES };
