var Pages = window.Pages = window.Pages || {};

Pages.aiFilter = async function () {
  App.setTitle('AI FILTER');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading AI filter insights...</div>';

  try {
    const [summaryRes, anomaliesRes, alertsRes] = await Promise.all([
      Api.get('/ai/fleet-summary'),
      Api.get('/ai/anomalies'),
      Api.get('/alerts?status=new'),
    ]);

    const summary = normalizeFleetSummary(summaryRes);
    const anomalies = normalizeAnomalies(anomaliesRes);
    const newAlerts = normalizeAlerts(alertsRes);

    page.innerHTML = `
      <div class="section-head">
        <h2>AI FILTER</h2>
        <p class="section-note">Focused intelligence from the fleet, filtered for the most actionable alerts and AI-generated risks.</p>
      </div>
      <div class="grid grid-cols-2" style="margin-bottom:24px;">
        <div class="card">
          <div class="card-title">Fleet Narrative</div>
          <div style="margin-top:12px; line-height:1.7;">${escapeHtml(summary.narrative)}</div>
        </div>
        <div class="card">
          <div class="card-title">AI Risk Summary</div>
          <div class="alert-meta" style="margin-top:12px;">0 monitored sites · 0 high-risk sites · 0 critical anomalies</div>
        </div>
      </div>
      <div class="grid grid-cols-2" style="gap:20px;">
        <div class="card">
          <div class="card-title">Active AI Anomalies</div>
          ${renderAnomalies(anomalies)}
        </div>
        <div class="card">
          <div class="card-title">New Alerts</div>
          ${renderAlerts(newAlerts)}
        </div>
      </div>
    `;
  } catch (err) {
    page.innerHTML = `<div class="empty-state">Could not load AI FILTER: ${escapeHtml(err.message)}</div>`;
  }
};

function renderAlerts(alerts) {
  if (!alerts.length) return '<div class="empty-state">No new alerts at the moment.</div>';
  return `<div class="alert-list">${alerts.map(a => `
    <div class="alert-row">
      <div class="alert-icon ${a.severity.toLowerCase()}"></div>
      <div class="alert-body">
        <div class="alert-message"><b>${escapeHtml(a.type.replace(/_/g, ' '))}</b> ${escapeHtml(a.message)}</div>
        <div class="alert-meta">${escapeHtml(a.created_at || a.createdAt || '')}</div>
      </div>
    </div>`).join('')}</div>`;
}
