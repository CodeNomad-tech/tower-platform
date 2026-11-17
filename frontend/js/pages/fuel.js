/* Fuel Integrity: every litre reconciled; theft, siphoning and excess burn separated. */
'use strict';

Pages.fuel = async function () {
  App.setTitle('Fuel Integrity');
  const page = document.getElementById('page');
  const rid = App.rid;
  let days = 30;

  async function load() {
    const [r, { deliveries }, { sites }] = await Promise.all([Api.get(`/fuel/integrity?days=${days}`), Api.get('/fuel/deliveries'), Api.get('/sites')]);
    if (App.stale(rid)) return;
    const f = r.fleet;
    const lossSites = r.sites.filter((s) => s.unexplainedL > 0);
    const findingBadge = (s) => ({ reconciled: h`<span class="badge b-ok">Reconciled</span>`, theft_events: h`<span class="badge b-crit">Theft events</span>`, slow_siphoning: h`<span class="badge b-crit">Slow siphoning</span>`, excess_burn: h`<span class="badge b-high">Excess burn</span>`, unexplained: h`<span class="badge b-watch">Unexplained</span>` }[s.finding]);
    page.innerHTML = h`
      <div class="row between mb">
        <div class="notice" style="flex:1">Opening stock + deliveries − expected burn (measured runtime × nameplate rate) − closing stock = <b>unexplained loss</b>.
          Nameplate rates are used on purpose: rates learned from the data would absorb any theft already present.</div>
        <div class="seg" role="group" aria-label="Period">${[7, 30, 90].map((d) => h`<button type="button" data-days="${d}" aria-pressed="${d === days}">${d} days</button>`)}</div>
      </div>
      <div class="grid g4">
        <div class="card kpi ${f.unexplainedL > 0 ? 'crit' : 'ok'}"><div class="kpi-label">Unexplained diesel loss</div><div class="kpi-value">${fmt.k(f.unexplainedValueK)}</div><div class="kpi-sub">${fmt.litres(f.unexplainedL)} over ${r.days} days at ${fmt.k(r.dieselPriceK)}/L</div></div>
        <div class="card kpi"><div class="kpi-label">Annualised at this rate</div><div class="kpi-value">${fmt.kShort(f.annualisedValueK)}</div><div class="kpi-sub">for this ${r.sites.length}-site fleet</div></div>
        <div class="card kpi"><div class="kpi-label">Delivered</div><div class="kpi-value">${fmt.litres(f.deliveredL)}</div><div class="kpi-sub">${f.deliveredL > 0 ? fmt.pct(f.unexplainedL / f.deliveredL * 100, 1) + ' unaccounted for' : ''}</div></div>
        <div class="card kpi ${f.sitesWithLoss ? 'high' : 'ok'}"><div class="kpi-label">Sites with unexplained loss</div><div class="kpi-value">${f.sitesWithLoss}</div><div class="kpi-sub">of ${r.sites.length} with generators</div></div>
      </div>

      <section class="card mt">
        <div class="card-h"><h2>Reconciliation by site</h2>
          <div class="legend"><span class="src"><i style="background:var(--src-generator)"></i>Expected burn</span><span class="src"><i style="background:var(--src-grid)"></i>Closing stock</span><span class="src"><i style="background:var(--crit)"></i>Unexplained</span>
          <button class="btn sm" id="csv">${ICONS.download} CSV</button></div></div>
        <div class="card-b flush"><div class="table-wrap"><table>
          <thead><tr><th>Site</th><th class="num">Opening + delivered</th><th style="min-width:160px">Where it went</th><th class="num">Unexplained</th><th>Finding</th></tr></thead>
          <tbody>${r.sites.map((s) => h`<tr class="link" data-href="#/site/${encodeURIComponent(s.siteId)}">
            <td><b>${s.name}</b><div class="small dim">${s.region}</div></td>
            <td class="num">${fmt.litres(s.openingL + s.deliveredL)}</td>
            <td>${Charts.stack([{ label: 'Expected burn', value: s.expectedBurnL, color: 'var(--src-generator)' }, { label: 'Closing stock', value: s.closingL, color: 'var(--src-grid)' }, { label: 'Unexplained', value: Math.max(0, s.unexplainedL), color: 'var(--crit)' }])}</td>
            <td class="num"><b style="${s.unexplainedL > 0 ? 'color:var(--crit)' : ''}">${fmt.litres(Math.max(0, s.unexplainedL))}</b><div class="small dim">${fmt.k(s.unexplainedValueK)}</div></td>
            <td>${findingBadge(s)}<div class="small muted" style="max-width:420px">${s.findingText}</div></td>
          </tr>`)}</tbody></table></div></div>
      </section>

      <div class="grid g2 mt">
        <section class="card"><div class="card-h"><h2>Sudden-drop events</h2><span class="sub">≥ 8% of tank in 15 min, generator off</span></div>
          <div class="card-b flush">${lossSites.some((s) => s.events.length) ? h`<table><tbody>${lossSites.flatMap((s) => s.events.map((e) => h`<tr><td class="small nowrap">${fmt.dateTime(e.ts)}</td><td><a href="#/site/${encodeURIComponent(s.siteId)}">${s.name}</a></td><td class="num"><b>${fmt.litres(e.litres)}</b></td><td class="num">${fmt.k(e.valueK)}</td></tr>`))}</tbody></table>` : empty('No sudden drops in this period')}</div></section>
        <section class="card"><div class="card-h"><h2>Deliveries</h2><span class="sub">Delivery notes recorded against sites</span></div>
          <div class="card-b">
            ${Api.can('operator') ? h`<form id="deliv" class="form-row mb">
              <div class="field"><label for="d-site">Site</label><select class="input" id="d-site" name="siteId" required>${sites.filter((s) => s.gen_kw > 0).map((s) => h`<option value="${s.id}">${s.name}</option>`)}</select></div>
              <div class="field"><label for="d-l">Litres</label><input class="input" id="d-l" name="litres" type="number" min="1" required></div>
              <div class="field"><label for="d-ref">Delivery note #</label><input class="input" id="d-ref" name="reference" maxlength="60"></div>
              <button class="btn primary" type="submit">Record delivery</button>
            </form>` : ''}
            ${deliveries.length ? h`<div class="table-wrap"><table><tbody>${deliveries.slice(0, 12).map((d) => h`<tr><td class="small nowrap">${fmt.dateTime(d.ts)}</td><td>${d.site_name}</td><td class="num">${fmt.litres(d.litres)}</td><td class="small dim">${d.reference || ''}</td></tr>`)}</tbody></table></div>` : empty('No deliveries recorded')}
          </div></section>
      </div>`.s;

    page.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { days = Number(b.dataset.days); load(); }));
    document.getElementById('csv').addEventListener('click', () => Api.download(`/reports/export/fuel.csv?days=${days}`, `toweriq-fuel-${days}d.csv`).catch(Toast.error.bind(Toast)));
    const form = document.getElementById('deliv');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await Api.post('/fuel/deliveries', { siteId: fd.get('siteId'), litres: Number(fd.get('litres')), reference: fd.get('reference') || null });
        Toast.show('Delivery recorded', `${fd.get('litres')} L`, 'ok');
        load();
      } catch (err) { Toast.error(err); }
    });
  }
  await load();
};
