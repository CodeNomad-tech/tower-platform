var Pages = window.Pages = window.Pages || {};

Pages.reports = async function () {
  App.setTitle('Reports & Analytics');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading…</div>';

  const [sla, predictive] = await Promise.all([
    Api.get('/reports/sla?periodDays=30'),
    Api.get('/reports/predictive-maintenance'),
  ]);

  page.innerHTML = `
    <div class="section-head">
      <h2>SLA Compliance (30 days)</h2>
      <div>
        <a class="btn" href="/api/reports/export/uptime.csv" target="_blank">Export uptime CSV</a>
        <a class="btn" href="/api/reports/export/alerts.csv" target="_blank">Export alerts CSV</a>
      </div>
    </div>
    <div class="card" style="margin-bottom:24px;">
      <table>
        <thead><tr><th>Site</th><th>Target</th><th>Actual</th><th>Status</th></tr></thead>
        <tbody>
          ${sla.results.map(r => `
            <tr>
              <td>${r.name}</td>
              <td>${r.targetPct}%</td>
              <td>${r.actualPct.toFixed(2)}%</td>
              <td>${r.breached ? '<span class="severity-critical">BREACH</span>' : '<span style="color:var(--green);">Compliant</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-head"><h2>Predictive Maintenance Indicators</h2></div>
    <div class="card">
      ${predictive.flags.length ? predictive.flags.map(f => `
        <div class="alert-row">
          <div class="alert-icon warning"></div>
          <div class="alert-body">
            <div class="alert-message">${f.name} — ${f.component}</div>
            <div class="alert-meta">${f.explanation}</div>
          </div>
        </div>`).join('') : '<div class="empty-state">No degrading trends detected — all equipment within normal parameters.</div>'}
    </div>
  `;
};
