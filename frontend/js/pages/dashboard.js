var Pages = window.Pages = window.Pages || {};

let dashboardRefreshTimer = null;

Pages.dashboard = async function () {
  App.setTitle('Executive Dashboard');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading AI intelligence...</div>';

  try {
    const [summaryRes, anomaliesRes, alertsRes] = await Promise.all([
      Api.get('/ai/fleet-summary'),
      Api.get('/ai/anomalies'),
      Api.get('/alerts'),
    ]);

    renderDashboard(summaryRes, anomaliesRes, alertsRes);
    bindDashboardLiveUpdates();
  } catch (err) {
    page.innerHTML = `<div class="empty-state">Could not load dashboard: ${escapeHtml(err.message)}</div>`;
  }
};

function renderDashboard(summaryRes, anomaliesRes, alertsRes) {
  const page = document.getElementById('page');
  const summary = normalizeFleetSummary(summaryRes);
  const anomalies = normalizeAnomalies(anomaliesRes);
  const openAlerts = normalizeAlerts(alertsRes).filter(a => a.status !== 'resolved');
  const criticalAlerts = summary.criticalAlertCount || openAlerts.filter(a => String(a.severity).toLowerCase() === 'critical').length;

  page.innerHTML = `
    <div class="fleet-narrative" id="fleet-narrative">${escapeHtml(summary.narrative)}</div>

    <div class="grid grid-cols-4" style="margin-bottom:24px;">
      ${kpiCard('Live Alert Counter', `<span id="live-alert-count">0</span>`, `${criticalAlerts} critical`)}
      ${kpiCard('Monthly Revenue', 'K0', 'Fleet recurring revenue')}
      ${kpiCard('High Risk Sites', 0, 'AI risk score')}
      ${kpiCard('AI Anomalies', 0, '0 critical')}
    </div>

    <div class="section-head"><h2>AI Site Risk</h2></div>
    <div class="grid grid-cols-3" id="site-grid" style="margin-bottom:24px;">
      ${renderSiteGrid(summary.sites)}
    </div>

    <div class="grid grid-cols-2">
      <div>
        <div class="section-head"><h2>Anomaly Feed</h2></div>
        <div class="card" id="anomaly-feed">${renderAnomalies(anomalies)}</div>
      </div>
      <div>
        <div class="section-head"><h2>Operations Snapshot</h2></div>
        <div class="card">${renderOpsSnapshot(summary.sites)}</div>
      </div>
    </div>
  `;
}

function bindDashboardLiveUpdates() {
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = setInterval(refreshFleetSummary, 30000);

  const unsubscribe = Live.on((msg) => {
    if (['alert', 'sla', 'maintenance'].includes(msg.channel)) incrementLiveAlertCounter();
    if (['heartbeat', 'power', 'fuel', 'env', 'alert', 'sla', 'maintenance'].includes(msg.channel)) {
      refreshFleetSummary();
    }
  });

  const cleanup = () => {
    unsubscribe();
    clearInterval(dashboardRefreshTimer);
    dashboardRefreshTimer = null;
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup, { once: true });
}

async function refreshFleetSummary() {
  if (!document.getElementById('fleet-narrative')) return;
  try {
    const [summaryRes, anomaliesRes, alertsRes] = await Promise.all([
      Api.get('/ai/fleet-summary'),
      Api.get('/ai/anomalies'),
      Api.get('/alerts'),
    ]);
    renderDashboard(summaryRes, anomaliesRes, alertsRes);
  } catch {
    /* Keep the last known intelligence on screen during transient outages. */
  }
}

function kpiCard(title, value, sub) {
  return `<div class="card"><div class="card-title">${title}</div><div class="card-value">${value}</div><div class="card-sub">${escapeHtml(String(sub))}</div></div>`;
}

function renderSiteGrid(sites) {
  if (!sites.length) return '<div class="empty-state">No sites configured yet</div>';
  return sites.map(siteRiskCardHtml).join('');
}

function siteRiskCardHtml(site) {
  const riskClass = 'risk-low';
  return `
    <div class="card site-card risk-card ${riskClass}" id="site-card-${escapeAttr(site.id)}" onclick="window.location.hash='#/site/${escapeAttr(site.id)}'">
      <div class="site-card-head">
        <div>
          <div class="site-name">${escapeHtml(site.name)}</div>
          <div class="site-region">${escapeHtml(site.region || site.id)}</div>
        </div>
        <span class="risk-badge ${riskClass}">LOW</span>
      </div>
      <div class="site-metrics site-metrics-ai">
        <div>24h uptime <b>0%</b></div>
        <div>30d uptime <b>0%</b></div>
        <div>Power <b>${escapeHtml(site.powerSource)}</b></div>
        <div>Fuel <b>0%</b></div>
      </div>
      <div class="tenant-strip">${site.tenants.length ? site.tenants.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('') : '<span class="tag">No tenants</span>'}</div>
    </div>`;
}

function renderAnomalies(anomalies) {
  const unique = uniqueAnomalies(anomalies);
  if (!unique.length) return '<div class="empty-state">No AI anomalies detected</div>';
  return unique.map(a => `
    <div class="anomaly-row">
      <div class="alert-icon ${a.severity.toLowerCase()}"></div>
      <div class="alert-body">
        <div class="alert-message">
          <span class="anomaly-type">${escapeHtml(a.type.replace(/_/g, ' '))}</span>
          <span class="anomaly-desc">${escapeHtml(a.description)}</span>
        </div>
        <div class="alert-meta">${escapeHtml(a.severity)} &middot; ${escapeHtml(a.algorithm)}</div>
      </div>
    </div>`).join('');
}

function uniqueAnomalies(anomalies) {
  const seen = new Set();
  return anomalies.filter(a => {
    const key = `${a.type}|${a.severity}|${a.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderOpsSnapshot(sites) {
  if (!sites.length) return '<div class="empty-state">No telemetry available</div>';
  return `
    <table>
      <thead><tr><th>Site</th><th>Power</th><th>Fuel</th><th>Tenants</th></tr></thead>
      <tbody>
        ${sites.map(s => `
          <tr>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.powerSource)}</td>
            <td>0%</td>
            <td>0</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function incrementLiveAlertCounter() {
  const el = document.getElementById('live-alert-count');
  if (!el) return;
  el.textContent = String((parseInt(el.textContent, 10) || 0) + 1);
}

function resetLiveAlertCounter() {
  const el = document.getElementById('live-alert-count');
  if (!el) return;
  el.textContent = '0';
}

function normalizeFleetSummary(res) {
  const raw = res.report || res.summary || res.data || res;
  const rawSites = raw.sites || raw.siteRisks || raw.site_risks || [];
  return {
    narrative: raw.narrative || raw.fleetNarrative || raw.fleet_narrative || raw.summaryText || 'Fleet intelligence is online and monitoring all tower sites.',
    monthlyRevenue: pickNumber(raw, ['totalFleetMonthlyRevenue', 'total_fleet_monthly_revenue', 'monthlyRevenue', 'monthly_revenue', 'totalRevenue', 'total_revenue'], 0),
    criticalAlertCount: pickNumber(raw, ['criticalAlertCount', 'critical_alert_count', 'criticalAlerts', 'critical_alerts'], 0),
    sites: rawSites.map(normalizeSummarySite),
  };
}

function normalizeSummarySite(site) {
  const tenants = site.tenants || site.tenantList || site.tenant_list || [];
  const flags = [
    ...(site.predictiveMaintenanceFlags || site.predictive_maintenance_flags || []),
    ...(site.fuelTheftAlerts || site.fuel_theft_alerts || []),
  ];
  return {
    id: site.id || site.siteId || site.site_id,
    name: site.name || site.siteName || site.site_name || site.id || site.site_id || 'Unknown site',
    region: site.region || site.location || '',
    risk: String(site.riskLevel || site.risk || site.riskScore || site.risk_score || 'LOW').toUpperCase(),
    uptime24h: pickNumber(site, ['uptimeLast24h', 'uptime_last_24h', 'uptime24h', 'uptime_24h'], null),
    uptime30d: pickNumber(site, ['uptimeLast30d', 'uptime_last_30d', 'uptime30d', 'uptime_30d'], null),
    powerSource: site.activePowerSource || site.active_power_source || site.powerSource || site.power_source || 'Unknown',
    fuelLevel: pickNumber(site, ['fuelLevel', 'fuel_level', 'fuelPct', 'fuel_pct'], null),
    tenants: tenants.map(t => typeof t === 'string' ? t : (t.name || t.tenantName || t.tenant_name || t.id)).filter(Boolean),
    flags: flags.map(f => typeof f === 'string' ? f : (f.description || f.message || f.type)).filter(Boolean),
  };
}

function normalizeAnomalies(res) {
  const list = res.anomalies || res.data || res || [];
  return list.map(a => ({
    type: String(a.type || 'ANOMALY').toUpperCase(),
    severity: String(a.severity || 'WARNING').toUpperCase(),
    description: a.description || a.message || 'AI detected unusual tower behavior.',
    algorithm: a.algorithm || a.algorithmExplanation || a.algorithm_explanation || a.explanation || 'Rule and trend analysis across telemetry streams.',
  }));
}

function normalizeAlerts(res) {
  return res.alerts || res.data || res || [];
}

function pickNumber(obj, keys, fallback) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      const value = Number(obj[key]);
      return Number.isFinite(value) ? value : fallback;
    }
  }
  return fallback;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}%`;
}

function formatKwacha(value) {
  return `K${Number(value || 0).toLocaleString()}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value || '');
}
