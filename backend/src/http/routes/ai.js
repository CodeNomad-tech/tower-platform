'use strict';
const db = require('../../db');
const { Router } = require('../router');
const { requireAuth } = require('../../auth/auth');
const { computeUptimePct } = require('../../engine/slaEngine');
const { evaluateGeneratorRuntimeTrend, evaluateFuelEfficiencyTrend } = require('../../engine/predictiveEngine');

const router = new Router();

router.get('/fleet-summary', requireAuth, (req, res) => {
    const sites = db.all('SELECT * FROM sites');
    const now = new Date();
    const since24h = new Date(now - 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const since30d = new Date(now - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const nowIso = now.toISOString().replace('T', ' ').slice(0, 19);

    const siteIntelligence = sites.map(site => {
        const power = db.all(
            `SELECT source, active, output_watts FROM power_readings
             WHERE site_id = ? ORDER BY ts DESC LIMIT 3`, [site.id]
        );
        const activePower = power.find(p => p.active === 1);
        const fuel = db.get(
            'SELECT level_pct, generator_on FROM fuel_readings WHERE site_id = ? ORDER BY ts DESC LIMIT 1',
            [site.id]
        );
        const uptime24h = computeUptimePct(site.id, since24h, nowIso);
        const uptime30d = computeUptimePct(site.id, since30d, nowIso);
        const activeAlerts = db.all(
            `SELECT type, severity, message FROM alerts
             WHERE site_id = ? AND status != 'resolved' ORDER BY created_at DESC`,
            [site.id]
        );
        const tenants = db.all('SELECT name FROM tenants WHERE site_id = ?', [site.id]);
        const runtimeTrend = evaluateGeneratorRuntimeTrend(site.id, 14);
        const fuelEfficiency = evaluateFuelEfficiencyTrend(site.id, 14);
        const theftAlerts = db.all(
            `SELECT message, created_at FROM alerts
             WHERE site_id = ? AND type = 'fuel_theft' AND created_at >= ?`,
            [site.id, since24h]
        );

        let riskScore = 0;
        let riskFactors = [];
        if (site.status === 'offline') { riskScore += 40; riskFactors.push('site offline'); }
        if (uptime24h < 99.5) { riskScore += 20; riskFactors.push(`uptime ${uptime24h.toFixed(1)}% below SLA`); }
        if (fuel && fuel.level_pct < 20) { riskScore += 25; riskFactors.push(`critical fuel ${fuel.level_pct.toFixed(0)}%`); }
        if (theftAlerts.length > 0) { riskScore += 35; riskFactors.push('fuel theft detected'); }
        if (activeAlerts.some(a => a.severity === 'critical')) { riskScore += 15; riskFactors.push('critical alerts active'); }
        if (runtimeTrend) { riskScore += 10; riskFactors.push('generator runtime trend increasing'); }
        if (fuelEfficiency) { riskScore += 10; riskFactors.push('fuel efficiency degrading'); }
        const riskLevel = riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW';

        return {
            siteId: site.id,
            siteName: site.name,
            region: site.region,
            status: site.status,
            riskLevel,
            riskScore,
            riskFactors,
            uptime: { last24h: uptime24h, last30d: uptime30d },
            power: {
                activeSource: activePower ? activePower.source : 'none',
                outputWatts: activePower ? activePower.output_watts : 0,
            },
            fuel: fuel ? { levelPct: fuel.level_pct, generatorOn: !!fuel.generator_on } : null,
            tenants: tenants.map(t => t.name),
            activeAlerts: activeAlerts.length,
            criticalAlerts: activeAlerts.filter(a => a.severity === 'critical').length,
            predictiveFlags: {
                generatorRuntimeTrend: runtimeTrend ? runtimeTrend.explanation : null,
                fuelEfficiencyTrend: fuelEfficiency ? fuelEfficiency.explanation : null,
            },
            fuelTheftAlerts: theftAlerts.length,
        };
    });

    const onlineSites = siteIntelligence.filter(s => s.status === 'online').length;
    const highRiskSites = siteIntelligence.filter(s => s.riskLevel === 'HIGH');
    const totalCriticalAlerts = siteIntelligence.reduce((s, site) => s + site.criticalAlerts, 0);
    const avgUptime24h = siteIntelligence.reduce((s, site) => s + site.uptime.last24h, 0) / sites.length;
    const totalTenants = db.get('SELECT COUNT(*) as c FROM tenants').c;
    const totalRevenue = db.get('SELECT SUM(contract_value_monthly) as total FROM tenants').total || 0;

    const narrativeParts = [];
    narrativeParts.push(`Fleet status: ${onlineSites}/${sites.length} sites online with ${avgUptime24h.toFixed(2)}% average uptime over the last 24 hours.`);
    if (totalCriticalAlerts > 0) narrativeParts.push(`${totalCriticalAlerts} critical alert${totalCriticalAlerts > 1 ? 's' : ''} require immediate attention across the fleet.`);
    if (highRiskSites.length > 0) narrativeParts.push(`High-risk sites requiring priority intervention: ${highRiskSites.map(s => s.siteName).join(', ')}.`);
    else narrativeParts.push('No sites are currently at high risk.');
    narrativeParts.push(`Commercial intelligence: ${totalTenants} active tenants generating K${totalRevenue.toLocaleString()} monthly across the fleet.`);
    const theftSites = siteIntelligence.filter(s => s.fuelTheftAlerts > 0);
    if (theftSites.length > 0) narrativeParts.push(`SECURITY ALERT: Potential fuel theft detected at ${theftSites.map(s => s.siteName).join(', ')} in the last 24 hours.`);
    const predictiveSites = siteIntelligence.filter(s => s.predictiveFlags.generatorRuntimeTrend || s.predictiveFlags.fuelEfficiencyTrend);
    if (predictiveSites.length > 0) narrativeParts.push(`Predictive maintenance recommended for ${predictiveSites.length} site${predictiveSites.length > 1 ? 's' : ''}: ${predictiveSites.map(s => s.siteName).join(', ')}.`);

    res.json({
        generatedAt: now.toISOString(),
        narrative: narrativeParts.join(' '),
        fleetHealth: {
            onlineSites,
            totalSites: sites.length,
            avgUptime24h,
            totalCriticalAlerts,
            totalTenants,
            totalMonthlyRevenue: totalRevenue,
        },
        siteIntelligence,
    });
});

router.get('/anomalies', requireAuth, (req, res) => {
    const sites = db.all('SELECT * FROM sites');
    const anomalies = [];

    for (const site of sites) {
        const theftAlerts = db.all(
            `SELECT * FROM alerts WHERE site_id = ? AND type = 'fuel_theft' AND status != 'resolved'`,
            [site.id]
        );
        for (const alert of theftAlerts) {
            anomalies.push({
                type: 'FUEL_THEFT',
                severity: 'CRITICAL',
                siteId: site.id,
                siteName: site.name,
                description: alert.message,
                detectedAt: alert.created_at,
                algorithm: 'Time-window fuel drop analysis: >15% drop within 10 minutes while generator is OFF',
            });
        }

        const runtimeTrend = evaluateGeneratorRuntimeTrend(site.id, 14);
        if (runtimeTrend) {
            anomalies.push({
                type: 'PREDICTIVE_MAINTENANCE',
                severity: 'WARNING',
                siteId: site.id,
                siteName: site.name,
                description: runtimeTrend.explanation,
                detectedAt: new Date().toISOString(),
                algorithm: 'Linear regression on daily generator runtime over 14-day window',
            });
        }

        const fuelEfficiency = evaluateFuelEfficiencyTrend(site.id, 14);
        if (fuelEfficiency) {
            anomalies.push({
                type: 'FUEL_EFFICIENCY_DEGRADATION',
                severity: 'WARNING',
                siteId: site.id,
                siteName: site.name,
                description: fuelEfficiency.explanation,
                detectedAt: new Date().toISOString(),
                algorithm: 'Linear regression on fuel consumption rate (%/hour) over 14-day window',
            });
        }

        const breaches = db.all(
            `SELECT * FROM sla_breaches WHERE site_id = ? ORDER BY period_end DESC LIMIT 3`,
            [site.id]
        );
        for (const breach of breaches) {
            anomalies.push({
                type: 'SLA_BREACH',
                severity: 'WARNING',
                siteId: site.id,
                siteName: site.name,
                description: `Uptime ${breach.actual_pct.toFixed(2)}% fell below target ${breach.target_pct}%`,
                detectedAt: breach.period_end,
                algorithm: 'Status log reconstruction: cumulative online time / total window time',
            });
        }
    }

    anomalies.sort((a, b) => {
        const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
        return (order[a.severity] || 0) - (order[b.severity] || 0);
    });

    res.json({ anomalies, total: anomalies.length, generatedAt: new Date().toISOString() });
});

module.exports = router;
