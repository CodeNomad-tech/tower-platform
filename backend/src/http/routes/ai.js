'use strict';
const db = require('../../db');
const { Router } = require('../router');
const { requireAuth } = require('../../auth/auth');
const { computeUptimePct } = require('../../engine/slaEngine');

const router = new Router();

function getLatestPowerSource(siteId) {
  const latest = db.get(
    'SELECT source, active FROM power_readings WHERE site_id = ? AND active = 1 ORDER BY ts DESC LIMIT 1',
    [siteId]
  );
  if (!latest) {
    const fallback = db.get('SELECT source FROM power_readings WHERE site_id = ? ORDER BY ts DESC LIMIT 1', [siteId]);
    return fallback ? formatPowerSource(fallback.source) : 'Unknown';
  }
  return formatPowerSource(latest.source);
}

function formatPowerSource(source) {
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Unknown';
}

function getFuelLevel(siteId) {
  const latest = db.get('SELECT level_pct FROM fuel_readings WHERE site_id = ? ORDER BY ts DESC LIMIT 1', [siteId]);
  return latest ? Number(latest.level_pct) : null;
}

function getTenantNames(siteId) {
  const tenants = db.all('SELECT name FROM tenants WHERE site_id = ? ORDER BY name', [siteId]);
  return tenants.map(t => t.name);
}

function getPredictiveFlags(siteId) {
  const flags = db.all('SELECT explanation FROM maintenance_flags WHERE site_id = ? ORDER BY created_at DESC LIMIT 5', [siteId]);
  return flags.map(f => f.explanation);
}

function getFuelTheftAlerts(siteId) {
  const alerts = db.all(
    "SELECT message FROM alerts WHERE site_id = ? AND type = 'fuel_theft' AND status != 'resolved' ORDER BY created_at DESC LIMIT 5",
    [siteId]
  );
  return alerts.map(a => a.message);
}

function classifyRisk(site) {
  let score = 0;
  if (site.criticalAlertCount > 0) score += 2;
  if (site.uptime24h != null && site.uptime24h < 99) score += 1;
  if (site.uptime30d != null && site.uptime30d < 99.5) score += 1;
  if (site.fuelLevel != null && site.fuelLevel < 20) score += 1;
  if ((site.predictiveMaintenanceFlags || []).length) score += 1;
  if ((site.fuelTheftAlerts || []).length) score += 2;
  if (score >= 4) return 'HIGH';
  if (score >= 2) return 'MEDIUM';
  return 'LOW';
}

router.get('/fleet-summary', requireAuth, (req, res) => {
  const sites = db.all('SELECT * FROM sites ORDER BY name');
  const now = new Date();
  const start24h = db.toSqliteTs(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const start30d = db.toSqliteTs(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

  const siteSummaries = sites.map(site => {
    const uptime24h = computeUptimePct(site.id, start24h, db.toSqliteTs(now));
    const uptime30d = computeUptimePct(site.id, start30d, db.toSqliteTs(now));
    const predictiveFlags = getPredictiveFlags(site.id);
    const fuelTheftAlerts = getFuelTheftAlerts(site.id);
    const criticalAlertCount = db.get(
      "SELECT COUNT(*) as c FROM alerts WHERE site_id = ? AND status != 'resolved' AND severity = 'critical'",
      [site.id]
    ).c;
    const fuelLevel = getFuelLevel(site.id);

    return {
      id: site.id,
      name: site.name,
      region: site.region,
      riskLevel: null,
      risk: null,
      uptime24h,
      uptime30d,
      activePowerSource: getLatestPowerSource(site.id),
      fuelLevel,
      tenants: getTenantNames(site.id),
      predictiveMaintenanceFlags: predictiveFlags,
      fuelTheftAlerts,
      criticalAlertCount,
      _riskScore: null,
    };
  });

  const siteRiskSummaries = siteSummaries.map(site => ({
    ...site,
    riskLevel: classifyRisk(site),
    risk: classifyRisk(site),
    _riskScore: undefined,
  }));

  const criticalAlerts = siteRiskSummaries.reduce((sum, site) => sum + site.criticalAlertCount, 0);
  const highRiskSites = siteRiskSummaries.filter(site => site.riskLevel === 'HIGH').length;
  const anomalies = db.get("SELECT COUNT(*) as c FROM alerts WHERE status != 'resolved' AND type IN ('fuel_theft', 'low_fuel')").c;
  const monthlyRevenue = db.get('SELECT COALESCE(SUM(contract_value_monthly), 0) as s FROM tenants').s;

  const narrative = `Fleet intelligence shows ${sites.length} monitored sites with ${criticalAlerts} critical alerts and ${anomalies} active anomaly signals; ${highRiskSites} sites currently warrant elevated operational attention.`;

  res.json({
    narrative,
    sites: siteRiskSummaries,
    monthlyRevenue,
    totalFleetMonthlyRevenue: monthlyRevenue,
    criticalAlertCount: criticalAlerts,
  });
});

router.get('/anomalies', requireAuth, (req, res) => {
  const anomalies = [];

  const theftAlerts = db.all(
    "SELECT site_id, message FROM alerts WHERE type = 'fuel_theft' AND status != 'resolved' ORDER BY created_at DESC"
  );
  for (const alert of theftAlerts) {
    const site = db.get('SELECT name FROM sites WHERE id = ?', [alert.site_id]);
    anomalies.push({
      type: 'FUEL_THEFT',
      severity: 'CRITICAL',
      description: `${site?.name || alert.site_id}: ${alert.message}`,
      algorithm: 'Fuel-theft detection compares recent fuel drops against generator-off windows and flags sharp losses that are inconsistent with normal consumption.',
    });
  }

  const maintenanceFlags = db.all('SELECT site_id, explanation FROM maintenance_flags ORDER BY created_at DESC LIMIT 20');
  const seenMaintenance = new Set();
  for (const flag of maintenanceFlags) {
    const key = `${flag.site_id}:${flag.explanation}`;
    if (seenMaintenance.has(key)) continue;
    seenMaintenance.add(key);
    const site = db.get('SELECT name FROM sites WHERE id = ?', [flag.site_id]);
    anomalies.push({
      type: 'PREDICTIVE_MAINTENANCE',
      severity: 'WARNING',
      description: `${site?.name || flag.site_id}: ${flag.explanation}`,
      algorithm: 'Predictive maintenance evaluates historical runtime and fuel-consumption trends to identify degrading equipment performance before failure.',
    });
  }

  const slaBreaches = db.all('SELECT site_id, actual_pct, target_pct FROM sla_breaches ORDER BY ts DESC LIMIT 20');
  for (const breach of slaBreaches) {
    const site = db.get('SELECT name FROM sites WHERE id = ?', [breach.site_id]);
    anomalies.push({
      type: 'SLA_BREACH',
      severity: breach.actual_pct < breach.target_pct - 2 ? 'CRITICAL' : 'WARNING',
      description: `${site?.name || breach.site_id}: uptime dipped to ${breach.actual_pct.toFixed(2)}% against a ${breach.target_pct.toFixed(2)}% target.`,
      algorithm: 'SLA breach analysis compares recent uptime against configured targets and flags recurring performance shortfalls.',
    });
  }

  res.json({ anomalies });
});

module.exports = router;
