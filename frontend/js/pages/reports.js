/* Reports: automated SLA report, power source utilisation by period, predictive maintenance, exports (NOC-compatible CSV). */
'use strict';

Pages.reports = async function () {
  App.setTitle('Reports');
  const page = document.getElementById('page');
  const rid = App.rid;
  let slaDays = 30, utilPeriod = 'monthly';

  page.innerHTML = h`
    <section class="card">
      <div class="card-h"><h2>Exports</h2><span class="sub">CSV files open in Excel and import into NOC and BI tools</span></div>
      <div class="card-b row">
        <button class="btn" data-dl="/reports/export/sla.csv?periodDays=30|toweriq-sla-30d.csv">${ICONS.download} SLA report (30 d)</button>
        <button class="btn" data-dl="/reports/export/alerts.csv|toweriq-alarms.csv">${ICONS.download} Alarm log</button>
        <button class="btn" data-dl="/reports/export/fuel.csv?days=30|toweriq-fuel-30d.csv">${ICONS.download} Fuel reconciliation</button>
        <button class="btn" data-dl="/resilience/plan.csv?loadShedding=12|toweriq-redundancy-plan.csv">${ICONS.download} Redundancy plan (12 h/day)</button>
      </div>
    </section>

    <section class="card mt">
      <div class="card-h"><h2>SLA compliance</h2>
        <div class="seg" role="group" aria-label="SLA period">${[[1, 'Day'], [7, 'Week'], [30, 'Month'], [90, 'Quarter']].map(([d, l]) => h`<button type="button" data-sla="${d}" aria-pressed="${d === slaDays}">${l}</button>`)}</div></div>
      <div class="card-b flush" id="sla"><div class="skeleton" style="margin:16px"></div></div>
    </section>

    <section class="card mt">
      <div class="card-h"><h2>Power source utilisation</h2>
        <div class="seg" role="group" aria-label="Utilisation period">${['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].map((p) => h`<button type="button" data-up="${p}" aria-pressed="${p === utilPeriod}">${fmt.label(p)}</button>`)}</div></div>
      <div class="card-b" id="util"><div class="skeleton"></div></div>
    </section>

    <section class="card mt"><div class="card-h"><h2>Predictive maintenance indicators</h2><span class="sub">Statistically significant equipment trends</span></div>
      <div class="card-b" id="pm"></div></section>`.s;

  page.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => {
    const [path, name] = b.dataset.dl.split('|');
    Api.download(path, name).then(() => Toast.show('Export ready', name, 'ok')).catch(Toast.error.bind(Toast));
  }));

  async function loadSla() {
    const r = await Api.get(`/reports/sla?periodDays=${slaDays}`);
    if (App.stale(rid)) return;
    document.getElementById('sla').innerHTML = h`<div class="table-wrap"><table>
      <thead><tr><th>Site</th><th>Region</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Downtime</th><th class="num">Allowed</th><th class="num">Outages</th><th>Status</th></tr></thead>
      <tbody>${r.results.map((x) => h`<tr class="link" data-href="#/site/${encodeURIComponent(x.siteId)}"><td><b>${x.name}</b></td><td>${x.region}</td><td class="num">${fmt.pct(x.targetPct, 1)}</td>
        <td class="num"><b style="${x.breached ? 'color:var(--crit)' : ''}">${fmt.pct(x.actualPct, 2)}</b></td><td class="num">${fmt.hours(x.downtimeHours)}</td><td class="num">${fmt.hours(x.allowedDowntimeHours)}</td><td class="num">${x.outageEvents}</td>
        <td>${x.breached ? h`<span class="badge b-crit">Breach</span>` : h`<span class="badge b-ok">Compliant</span>`}</td></tr>`)}</tbody></table></div>
      <p class="hint" style="padding:0 16px">${r.compliant}/${r.total} sites compliant over ${r.periodDays} day(s). Availability is reconstructed from logged status transitions; "no comms" counts as down.</p>`.s;
  }

  async function loadUtil() {
    const r = await Api.get(`/reports/utilization?period=${utilPeriod}`);
    if (App.stale(rid)) return;
    const order = ['grid', 'solar', 'battery', 'generator', 'dark'];
    const by = (arr) => order.map((k) => arr.find((u) => u.source === k) || { source: k, hours: 0, pct: 0 });
    document.getElementById('util').innerHTML = h`
      <div class="legend mb">${order.map((k) => srcTag(k))}</div>
      <div class="row mb" style="gap:16px"><b style="min-width:180px">Whole fleet</b><div style="flex:1">${Charts.stack(by(r.fleet).map((u) => ({ label: SOURCE_LABEL[u.source], value: u.hours, color: SOURCE_COLORS[u.source] })))}</div>
        <span class="small muted">${by(r.fleet).map((u) => `${SOURCE_LABEL[u.source]} ${u.pct.toFixed(0)}%`).join(' · ')}</span></div>
      ${r.sites.map((s) => h`<div class="row" style="gap:16px;padding:5px 0"><a href="#/site/${encodeURIComponent(s.siteId)}" style="min-width:180px">${s.name}</a>
        <div style="flex:1">${Charts.stack(by(s.utilization).map((u) => ({ label: SOURCE_LABEL[u.source], value: u.hours, color: SOURCE_COLORS[u.source] })))}</div>
        <span class="small dim" style="min-width:90px;text-align:right">${by(s.utilization).find((u) => u.source === 'generator').pct.toFixed(0)}% diesel</span></div>`)}
      <p class="hint">Share of hours by majority supply source. ${r.sites[0] && r.sites[0].coverageDays < r.sites[0].periodDays - 0.5 ? `History available: ${r.sites[0].coverageDays.toFixed(0)} days, so longer periods show what exists.` : ''}</p>`.s;
  }

  async function loadPm() {
    const r = await Api.get('/reports/predictive-maintenance');
    if (App.stale(rid)) return;
    document.getElementById('pm').innerHTML = (r.flags.length ? h`${r.flags.map((f) => h`<div class="notice warn mb"><b><a href="#/site/${encodeURIComponent(f.siteId)}">${f.name}</a>: ${fmt.label(f.component)}</b><br>${f.explanation}</div>`)}`
      : empty('No degrading trends detected', 'Burn rate and generator runtime are regressed per site; only material, statistically significant trends are flagged.')).s;
  }

  page.querySelectorAll('[data-sla]').forEach((b) => b.addEventListener('click', () => { slaDays = Number(b.dataset.sla); page.querySelectorAll('[data-sla]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadSla(); }));
  page.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { utilPeriod = b.dataset.up; page.querySelectorAll('[data-up]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadUtil(); }));
  await Promise.all([loadSla(), loadUtil(), loadPm()]);
};
