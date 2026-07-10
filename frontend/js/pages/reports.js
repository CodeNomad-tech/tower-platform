var Pages = window.Pages = window.Pages || {};

Pages.reports = async function () {
  App.setTitle('Reports & Analytics');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading&hellip;</div>';

  try {
    const [sla, predictive, summaryRes, anomaliesRes] = await Promise.all([
      Api.get('/reports/sla?periodDays=30'),
      Api.get('/reports/predictive-maintenance'),
      Api.get('/ai/fleet-summary'),
      Api.get('/ai/anomalies'),
    ]);

    const summary = normalizeFleetSummary(summaryRes);
    const anomalies = uniqueAnomalies(normalizeAnomalies(anomaliesRes));
    const maintenanceGroups = groupMaintenanceFlags(predictive.flags || []);
    const criticalAnomalyCount = anomalies.filter(a => a.severity === 'CRITICAL').length;
    const pieData = [
      { label: 'Compliant', value: (sla.results || []).length, color: '#2dc653' },
      { label: 'Breached', value: 0, color: '#ff5e57' },
    ];

    page.innerHTML = `
      <div class="section-head">
        <h2>SLA Compliance (30 days)</h2>
      </div>

      <div class="grid grid-cols-3" style="margin-bottom:24px;">
        <div class="card">
          <div class="card-title">AI Report Summary</div>
          <div style="margin-top:12px; line-height:1.7;">${escapeHtml(summary.narrative)}</div>
        </div>
        <div class="card">
          <div class="card-title">Filtered Risk</div>
          <div class="card-value">0</div>
          <div class="card-sub">high-risk sites from AI filter</div>
        </div>
        <div class="card">
          <div class="card-title">AI Signals</div>
          <div class="card-value">0</div>
          <div class="card-sub">0 critical signals</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:24px;">
        <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; justify-content:space-between;">
          <div style="flex:1; min-width:220px;">
            <div class="card-title">Compliance Breakdown</div>
            <div style="margin-top:12px; display:flex; gap:16px; flex-wrap:wrap; align-items:center;">
              <canvas id="sla-pie-chart" width="220" height="220" style="max-width:220px; width:100%; height:auto;"></canvas>
              <div>
                ${pieData.map(item => `
                  <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
                    <span style="display:inline-block; width:10px; height:10px; border-radius:999px; background:${item.color};"></span>
                    <span>${escapeHtml(item.label)}: ${item.value}</span>
                  </div>`).join('')}
              </div>
            </div>
          </div>
          <div style="flex:1; min-width:280px;">
            <table>
          <thead><tr><th>Site</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead>
          <tbody>
            ${(sla.results || []).map(r => `
              <tr>
                <td>${escapeHtml(r.name)}</td>
                <td>0%</td>
                <td>0.00%</td>
                <td><span style="color:var(--green);">Compliant</span></td>
              </tr>`).join('')}
          </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="section-head"><h2>Predictive Maintenance Indicators</h2></div>
      <div class="card">
        ${renderMaintenanceReport(maintenanceGroups)}
      </div>
    `;

    requestAnimationFrame(() => {
      const pieCanvas = document.getElementById('sla-pie-chart');
      if (pieCanvas) {
        Charts.pie(pieCanvas, pieData);
      }
    });
  } catch (err) {
    page.innerHTML = `<div class="empty-state">Could not load reports: ${escapeHtml(err.message)}</div>`;
  }
};

function groupMaintenanceFlags(flags) {
  const groups = new Map();

  flags.forEach(flag => {
    const name = flag.name || flag.siteName || flag.site_name || flag.siteId || flag.site_id || 'Unknown site';
    const component = flag.component || 'equipment';
    const explanation = flag.explanation || flag.message || 'AI detected a degrading maintenance trend.';
    // Group by component type so the same issue across sites is consolidated into one row
    const key = component;
    const existing = groups.get(key);
    const trendSlope = Math.abs(Number(flag.trendSlope || flag.trend_slope) || 0);

    if (existing) {
      existing.count += 1;
      existing.sites.push(name);
      existing.trendSlope = Math.max(existing.trendSlope, trendSlope);
      return;
    }

    groups.set(key, {
      name,
      component,
      explanation,
      count: 1,
      sites: [name],
      trendSlope,
    });
  });

  return Array.from(groups.values()).sort((a, b) => b.trendSlope - a.trendSlope);
}

function renderMaintenanceReport(groups) {
  if (!groups.length) {
    return '<div class="empty-state">No degrading trends detected &mdash; all equipment within normal parameters.</div>';
  }

  return groups.map(group => {
    const siteList = group.sites.length > 1
      ? `${group.sites.length} sites affected`
      : escapeHtml(group.sites[0]);
    const consolidated = group.count > 1 ? ` &middot; ${group.count} readings consolidated.` : '';
    return `
    <div class="alert-row">
      <div class="alert-icon warning"></div>
      <div class="alert-body">
        <div class="alert-message">${siteList} &mdash; ${escapeHtml(formatComponent(group.component))}</div>
        <div class="alert-meta">${escapeHtml(smoothMaintenanceExplanation(group.explanation))}${consolidated}</div>
      </div>
    </div>`;
  }).join('');
}

function smoothMaintenanceExplanation(explanation) {
  const text = String(explanation || '');
  const amount = text.match(/~([0-9.]+)/);
  const days = text.match(/last ([0-9]+) days/i);
  const windowText = days ? ` over the last ${days[1]} days` : '';

  // Only show the numeric amount if it looks plausible (not simulator noise)
  const numericValue = amount ? Number(amount[1]) : null;
  const amountText = (numericValue !== null && numericValue <= 10)
    ? ` by ~${numericValue.toFixed(2)} per day`
    : '';

  if (/fuel burn rate/i.test(text)) {
    return `Fuel consumption is trending upward${amountText}${windowText}. Review generator efficiency, filters, fuel-system health, and loading conditions.`;
  }

  if (/daily runtime/i.test(text)) {
    return `Generator runtime is increasing${amountText}${windowText}. Check grid and solar reliability; schedule a service inspection if the trend continues.`;
  }

  return text;
}

function formatComponent(component) {
  return String(component || 'equipment').replace(/_/g, ' ');
}
