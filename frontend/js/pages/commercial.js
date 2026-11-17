/* Commercial intelligence: tenancy, utilisation, revenue opportunity, and revenue put at risk by downtime. */
'use strict';

Pages.commercial = async function () {
  App.setTitle('Commercial');
  const page = document.getElementById('page');
  const rid = App.rid;

  async function load() {
    const t = await Api.get('/tenancy');
    if (App.stale(rid)) return;
    const T = t.totals;
    page.innerHTML = h`
      <div class="notice warn mb">Tenant names are real Zambian operators used as examples. All contract values are <b>illustrative demo figures</b>, not commercial data.</div>
      <div class="grid g4">
        <div class="card kpi"><div class="kpi-label">Tenancy ratio</div><div class="kpi-value">${T.tenancyRatio.toFixed(2)}</div><div class="kpi-sub">${T.tenants} tenants on ${T.sites} towers</div></div>
        <div class="card kpi"><div class="kpi-label">Slot occupancy</div><div class="kpi-value">${fmt.pct(T.occupancyPct)}</div><div class="kpi-sub">${T.tenants}/${T.capacity} slots filled</div></div>
        <div class="card kpi"><div class="kpi-label">Monthly colocation revenue</div><div class="kpi-value">${fmt.kShort(T.monthlyRevenue)}</div><div class="kpi-sub">${fmt.kShort(T.opportunityMonthly)}/month more if all slots sold</div></div>
        <div class="card kpi ${T.slaCreditExposure30d > 0 ? 'high' : 'ok'}"><div class="kpi-label">Revenue at risk from downtime (30 d)</div><div class="kpi-value">${fmt.kShort(T.slaCreditExposure30d)}</div><div class="kpi-sub">SLA credits implied by dark hours</div></div>
      </div>

      <section class="card mt">
        <div class="card-h"><h2>Sites by commercial position</h2><span class="sub">A tower that keeps going dark is hard to sell, so free slots are shown against reliability</span></div>
        <div class="card-b flush"><div class="table-wrap"><table>
          <thead><tr><th>Site</th><th>Tenants</th><th style="min-width:140px">Occupancy</th><th class="num">Revenue/month</th><th class="num">Free slots</th><th class="num">Opportunity/month</th><th class="num">Availability 30 d</th><th class="num">At risk (30 d)</th><th>Sell readiness</th></tr></thead>
          <tbody>${t.sites.slice().sort((a, b) => b.opportunityMonthly - a.opportunityMonthly).map((s) => h`<tr class="link" data-href="#/site/${encodeURIComponent(s.siteId)}">
            <td><b>${s.name}</b><div class="small dim">${s.region}</div></td>
            <td class="small">${s.tenants.map((x) => x.name).join(', ') || '—'}</td>
            <td><div class="small">${s.tenantCount}/${s.capacity}</div>${meter(s.occupancyPct)}</td>
            <td class="num">${fmt.k(s.monthlyRevenue)}</td>
            <td class="num">${s.emptySlots}</td>
            <td class="num">${s.emptySlots ? fmt.k(s.opportunityMonthly) : '—'}</td>
            <td class="num" style="color:${s.availability30d < 99.5 ? 'var(--crit)' : ''}">${fmt.pct(s.availability30d, 2)}</td>
            <td class="num">${s.slaCreditExposure30d > 0 ? fmt.k(s.slaCreditExposure30d) : '—'}</td>
            <td>${!s.emptySlots ? h`<span class="badge b-neutral">Full</span>` : s.availability30d >= 99 ? h`<span class="badge b-ok">Ready to sell</span>` : h`<span class="badge b-high">Fix power first</span>`}</td>
          </tr>`)}</tbody></table></div></div>
      </section>

      ${Api.can('admin') ? h`<section class="card mt"><div class="card-h"><h2>Add a tenant</h2></div><div class="card-b">
        <form id="tenant" class="form-row">
          <div class="field"><label for="t-site">Site</label><select class="input" id="t-site" name="site">${t.sites.filter((s) => s.emptySlots).map((s) => h`<option value="${s.siteId}">${s.name} (${s.emptySlots} free)</option>`)}</select></div>
          <div class="field"><label for="t-name">Tenant</label><input class="input" id="t-name" name="name" required maxlength="120"></div>
          <div class="field"><label for="t-val">Monthly value (K)</label><input class="input" id="t-val" name="value" type="number" min="0" required></div>
          <button class="btn primary" type="submit">Add tenant</button>
        </form></div></section>` : ''}`.s;

    const form = document.getElementById('tenant');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try { await Api.post(`/tenancy/${encodeURIComponent(fd.get('site'))}/tenants`, { name: fd.get('name'), contract_value_monthly: Number(fd.get('value')) }); Toast.show('Tenant added', fd.get('name'), 'ok'); load(); }
      catch (err) { Toast.error(err); }
    });
  }
  await load();
};
