var Pages = window.Pages = window.Pages || {};

Pages.tenancy = async function () {
  App.setTitle('Tenancy & Commercial Intelligence');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading…</div>';

  const [summary, opportunities] = await Promise.all([Api.get('/tenancy'), Api.get('/tenancy/opportunities')]);

  page.innerHTML = `
    <div class="section-head"><h2>Site Occupancy</h2></div>
    <div class="grid grid-cols-3" style="margin-bottom:24px;" id="occupancy-grid">
      ${summary.sites.map(occupancyCard).join('')}
    </div>

    <div class="section-head"><h2>Revenue Opportunities</h2></div>
    <div class="card">
      ${opportunities.opportunities.length ? `
        <table>
          <thead><tr><th>Site</th><th>Occupancy</th><th>Empty slots</th><th>Est. monthly opportunity</th></tr></thead>
          <tbody>
            ${opportunities.opportunities.map(o => `
              <tr>
                <td>${o.name}</td>
                <td>${o.occupancyPct.toFixed(0)}%</td>
                <td>${o.emptySlots}</td>
                <td>K${o.estimatedMonthlyOpportunity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state">All sites fully occupied</div>'}
    </div>
  `;
};

function occupancyCard(s) {
  const color = s.occupancyPct >= 80 ? 'var(--green)' : s.occupancyPct >= 40 ? 'var(--amber)' : 'var(--red)';
  return `
    <div class="card">
      <div class="card-title">${s.name}</div>
      <div class="card-value">${s.tenantCount}/${s.capacity}</div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.min(100, s.occupancyPct)}%; background:${color};"></div></div>
      <div class="card-sub">K${s.monthlyRevenue.toLocaleString()} / month</div>
    </div>`;
}
