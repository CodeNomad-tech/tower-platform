/* Sites list + Site detail (the runway forecast lives here). */
'use strict';

Pages.sites = async function () {
  App.setTitle('Sites');
  const page = document.getElementById('page');
  const rid = App.rid;
  let filter = '';

  async function load() {
    const [{ sites }, runway] = await Promise.all([Api.get('/sites'), Api.get('/resilience/runway')]);
    if (App.stale(rid)) return;
    const risk = Object.fromEntries(runway.sites.map((s) => [s.siteId, s]));
    const q = filter.toLowerCase();
    const rows = sites.filter((s) => !q || `${s.id} ${s.name} ${s.region}`.toLowerCase().includes(q));
    page.innerHTML = h`
      <div class="row between mb">
        <div class="field" style="max-width:320px;flex:1"><label for="q">Search sites</label><input class="input" id="q" type="search" placeholder="Name, ID or region" value="${filter}"></div>
        <span class="muted small">${sites.length} sites · status refreshes live</span>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Site</th><th>Region</th><th>Status</th><th>Supply</th><th>Fuel</th><th>Battery</th><th>Backup</th><th class="num">Tenants</th><th class="num">Open alarms</th><th>72 h outlook</th></tr></thead>
        <tbody>${rows.length ? rows.map((s) => {
          const r = risk[s.id];
          return h`<tr class="link" data-href="#/site/${encodeURIComponent(s.id)}">
            <td><a href="#/site/${encodeURIComponent(s.id)}"><b>${s.name}</b></a><div class="dim small mono">${s.id}</div></td>
            <td>${s.region || '—'}</td>
            <td>${s.status === 'online' ? h`<span class="badge b-ok">Powered</span>` : s.status === 'down' ? h`<span class="badge b-dark">Dark</span>` : s.status === 'offline' ? h`<span class="badge b-high">No comms</span>` : h`<span class="badge b-neutral">Unknown</span>`}</td>
            <td>${srcTag(s.active_source)}</td>
            <td style="min-width:110px">${s.gen_kw > 0 ? h`<div class="small">${fmt.pct(s.fuel_pct)}</div>${meter(s.fuel_pct)}` : h`<span class="dim small">No generator</span>`}</td>
            <td style="min-width:110px">${s.battery_kwh > 0 ? h`<div class="small">${fmt.pct(s.battery_pct)}</div>${meter(s.battery_pct)}` : h`<span class="dim small">None</span>`}</td>
            <td class="small muted">${[s.battery_kwh ? `${s.battery_kwh} kWh` : null, s.solar_kw ? `${s.solar_kw} kWp PV` : null, s.gen_kw ? `${s.gen_kw} kVA gen` : null].filter(Boolean).join(' · ') || '—'}</td>
            <td class="num">${s.tenant_count}</td>
            <td class="num">${s.open_alerts || '—'}</td>
            <td>${r ? riskBadge(r.risk) : '—'}</td>
          </tr>`;
        }) : h`<tr><td colspan="10">${empty('No matching sites')}</td></tr>`}</tbody>
      </table></div></div>`.s;
    const input = document.getElementById('q');
    input.addEventListener('input', debounce(() => { filter = input.value; load().then(() => { const i = document.getElementById('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250));
  }
  await load();
  liveRefresh(['status', 'alert', 'forecast'], load, 3000);
};

Pages.site = async function (siteId) {
  const page = document.getElementById('page');
  const rid = App.rid;
  let scenario = 'learned';
  let utilPeriod = 'weekly';

  const [d, tl] = await Promise.all([Api.get(`/sites/${encodeURIComponent(siteId)}`), Api.get(`/sites/${encodeURIComponent(siteId)}/timeline?hours=48`)]);
  if (App.stale(rid)) return;
  const s = d.site, a = d.assets;
  App.setTitle(s.name);
  const alerts = (await Api.get(`/alerts?siteId=${encodeURIComponent(siteId)}&limit=15`)).alerts;
  if (App.stale(rid)) return;

  const statusBadge = s.status === 'online' ? h`<span class="badge b-ok">Powered</span>` : s.status === 'down' ? h`<span class="badge b-dark">Dark: tenants off air</span>` : h`<span class="badge b-high">${fmt.label(s.status)}</span>`;
  const fi = d.fuelIntegrity;
  const sla = d.sla30d;

  page.innerHTML = h`
    <div class="row between mb">
      <div class="row">
        <a class="btn sm" href="#/sites">← All sites</a>
        <span class="mono dim">${s.id}</span><span class="muted">${s.region}</span>${statusBadge}
        ${s.simulated ? h`<span class="pill sim">Simulated site</span>` : ''}
      </div>
    </div>

    <section class="card" aria-labelledby="h-runway">
      <div class="card-h">
        <h2 id="h-runway">Will this tower stay on? <span class="sub">If nobody does anything</span></h2>
        <div class="seg" role="group" aria-label="Grid scenario">
          ${[['learned', 'Normal power cuts'], ['8', '8 h cuts/day'], ['12', '12 h cuts/day'], ['18', '18 h cuts/day']].map(([v, l]) => h`<button type="button" data-scn="${v}" aria-pressed="${v === scenario}">${l}</button>`)}
        </div>
      </div>
      <div class="runway mt" id="runway"><div class="skeleton" style="grid-column:1/-1;margin:16px"></div></div>
    </section>

    <section class="card mt">
        <div class="card-h"><h2>What powered this tower in the last 2 days</h2>
          <div class="legend">${['grid', 'solar', 'battery', 'generator', 'none'].map((k) => srcTag(k))}<span class="src"><i style="background:var(--src-generator);height:2px"></i>Fuel %</span><span class="src"><i style="background:var(--src-battery);height:2px"></i>Battery %</span></div>
        </div>
        <div class="card-b"><div id="timeline"></div><p class="hint">The coloured strip shows which power source was running. The lines show diesel and battery levels.</p></div>
    </section>

    <details class="more mt" id="more">
      <summary>Show more details: power usage, equipment, SLA, fuel accounting, tenants, alarms</summary>
    <div class="grid g2 mt">
      <section class="card">
        <div class="card-h"><h2>Power source utilisation</h2>
          <div class="seg" role="group" aria-label="Period">${['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].map((p) => h`<button type="button" data-util="${p}" aria-pressed="${p === utilPeriod}">${fmt.label(p)}</button>`)}</div>
        </div>
        <div class="card-b"><div id="util"></div><div class="hint" id="util-note"></div></div>
      </section>
    </div>

    <div class="grid g3 mt">
      <section class="card"><div class="card-h"><h3>Energy assets</h3><span class="sub">What the forecast reasons over</span></div>
        <div class="card-b"><dl class="kv">
          <dt>Average load</dt><dd>${a.load_kw} kW</dd>
          <dt>Battery (usable)</dt><dd>${a.battery_kwh ? a.battery_kwh + ' kWh' : 'None'}</dd>
          <dt>Solar PV</dt><dd>${a.solar_kw ? a.solar_kw + ' kWp' : 'None'}</dd>
          <dt>Generator</dt><dd>${a.gen_kw ? a.gen_kw + ' kVA' : 'None'}</dd>
          ${a.gen_kw ? h`<dt>Diesel tank</dt><dd>${fmt.litres(a.tank_l)}</dd><dt>Burn rate (nameplate)</dt><dd>${a.gen_burn_lph} L/h</dd>` : ''}
          <dt>Refuel lead time</dt><dd>${a.refuel_lead_h} h</dd>
        </dl></div></section>

      <section class="card"><div class="card-h"><h3>SLA, last 30 days</h3>${sla.breached ? h`<span class="badge b-crit">Breach</span>` : h`<span class="badge b-ok">Compliant</span>`}</div>
        <div class="card-b"><dl class="kv">
          <dt>Availability</dt><dd><b>${fmt.pct(sla.actualPct, 2)}</b></dd>
          <dt>Target</dt><dd>${fmt.pct(sla.targetPct, 1)}</dd>
          <dt>Downtime</dt><dd>${fmt.hours(sla.downtimeHours)}</dd>
          <dt>Allowed downtime</dt><dd>${fmt.hours(sla.allowedDowntimeHours)}</dd>
          <dt>Outage events</dt><dd>${sla.outageEvents}</dd>
          <dt>24 h availability</dt><dd>${fmt.pct(d.uptime24h, 2)}</dd>
        </dl></div></section>

      <section class="card"><div class="card-h"><h3>Fuel integrity, 30 days</h3>${fi ? (fi.unexplainedL > 0 ? h`<span class="badge b-crit">${fmt.litres(fi.unexplainedL)} missing</span>` : h`<span class="badge b-ok">Reconciled</span>`) : ''}</div>
        <div class="card-b">${fi ? h`<dl class="kv">
          <dt>Opening stock</dt><dd>${fmt.litres(fi.openingL)}</dd>
          <dt>+ Delivered (${fi.deliveries})</dt><dd>${fmt.litres(fi.deliveredL)}</dd>
          <dt>− Expected burn (${fmt.int(fi.runtimeHours)} h × ${fi.nameplateBurnLph} L/h)</dt><dd>${fmt.litres(fi.expectedBurnL)}</dd>
          <dt>− Closing stock</dt><dd>${fmt.litres(fi.closingL)}</dd>
          <dt><b>= Unexplained</b></dt><dd><b>${fmt.litres(fi.unexplainedL)} · ${fmt.k(fi.unexplainedValueK)}</b></dd>
        </dl><p class="small muted">${fi.findingText}</p>` : empty('No generator at this site')}</div></section>
    </div>

    <div class="grid g3 mt">
      <section class="card"><div class="card-h"><h3>Predictive maintenance</h3></div>
        <div class="card-b">${d.maintenance.length ? d.maintenance.map((m) => h`<div class="notice warn mb"><b>${fmt.label(m.component)}</b><br>${m.explanation}</div>`) : h`<p class="muted small">No degrading trend detected. Burn rate and generator runtime are tested for statistically significant drift.</p>`}</div></section>
      <section class="card"><div class="card-h"><h3>Environment & security</h3></div>
        <div class="card-b"><dl class="kv">
          <dt>Shelter temperature</dt><dd>${d.latestEnv?.temperature_c != null ? d.latestEnv.temperature_c.toFixed(1) + ' °C' : '—'}</dd>
          <dt>Smoke</dt><dd>${d.latestEnv?.smoke_detected ? h`<span class="badge b-crit">Detected</span>` : 'Clear'}</dd>
          <dt>Door</dt><dd>${d.latestEnv?.door_open ? 'Open' : 'Closed'}</dd>
        </dl>
        <div class="small muted mt">Recent security events</div>
        ${d.security.length ? d.security.slice(0, 4).map((e) => h`<div class="small">${fmt.dateTime(e.ts)}: ${fmt.label(e.event_type)} via ${e.source}${e.confidence != null ? ` (${e.confidence.toFixed(2)})` : ''}</div>`) : h`<div class="small dim">None recorded</div>`}
        </div></section>
      <section class="card"><div class="card-h"><h3>Tenants (${d.tenants.length}/${s.capacity})</h3></div>
        <div class="card-b">${d.tenants.length ? h`<dl class="kv">${d.tenants.map((t) => h`<dt>${t.name}</dt><dd>${fmt.k(t.contract_value_monthly)}/mo</dd>`)}</dl>` : empty('No tenants')}
        <p class="hint">${Math.max(0, s.capacity - d.tenants.length)} free slot(s). Contract values are illustrative demo figures.</p></div></section>
    </div>

    <div class="grid g2 mt">
      <section class="card"><div class="card-h"><h3>Automatic power switching</h3><span class="sub">Most recent first</span></div>
        <div class="card-b flush">${d.switches.length ? h`<table><tbody>${d.switches.map((w) => h`<tr><td class="small muted nowrap">${fmt.dateTime(w.ts)}</td><td>${srcTag(w.from_source)} → ${srcTag(w.to_source)}</td><td class="small dim">${w.reason}</td></tr>`)}</tbody></table>` : empty('No switches recorded')}</div></section>
      <section class="card"><div class="card-h"><h3>Alarms</h3><a class="btn sm" href="#/alarms">All alarms</a></div>
        <div class="card-b flush">${alerts.length ? h`<table><tbody>${alerts.slice(0, 8).map((x) => h`<tr><td>${sevBadge(x.severity)}</td><td><div>${x.message}</div><div class="small dim">${fmt.dateTime(x.created_at)} · ${fmt.label(x.status)}</div></td></tr>`)}</tbody></table>` : empty('No alarms for this site')}</div></section>
    </div>
    </details>`.s;

  Charts.timeline(document.getElementById('timeline'), tl.points, { deliveries: tl.deliveries, theft: tl.theft });

  async function loadRunway() {
    const box = document.getElementById('runway');
    const q = scenario === 'learned' ? '' : `?loadShedding=${scenario}`;
    const r = await Api.get(`/sites/${encodeURIComponent(siteId)}/forecast${q}`);
    if (App.stale(rid)) return;
    const f = r.forecast;
    const big = r.risk === 'dark' ? h`<div class="runway-big" style="color:var(--crit)">Off air now</div>`
      : f.medianTimeToDarkH != null ? h`<div class="runway-big" style="color:${r.risk === 'critical' ? 'var(--crit)' : 'var(--high)'}">${fmt.hours(f.medianTimeToDarkH)}<br><small>until it most likely goes dark</small></div>`
        : h`<div class="runway-big" style="color:var(--ok)">Stays on<br><small>${fmt.pct((1 - f.pDark72h) * 100)} chance it stays on for the next 3 days</small></div>`;
    const causeText = f.cause === 'fuel' ? `The generator will run out of diesel. It uses about ${r.burnLph.toFixed(1)} litres an hour${r.standingLossLph > 0.05 ? `, and another ${(r.standingLossLph * 24).toFixed(0)} litres a day are disappearing even when it's off` : ''}.`
      : f.cause === 'capacity' ? "The battery can't last through the power cuts, and there's no generator to take over." : 'It has enough fuel and battery to ride out the power cuts.';
    box.innerHTML = h`
      <div class="runway-facts">
        ${big}
        <div class="row">${riskBadge(r.risk)}<span class="small muted">${f.scenario === 'learned' ? "Using this tower's usual power cuts" : 'What if: ' + f.scenario.replace('h/day', 'hours of cuts a day')}</span></div>
        <div><div class="fact-l">Chance it goes dark</div><div class="fact-v">${fmt.pct(f.pDark24h * 100)} by tomorrow · ${fmt.pct(f.pDark72h * 100)} within 3 days</div></div>
        <div><div class="fact-l">Why</div><div class="small">${causeText}</div></div>
        ${f.expectedDarkHours > 0.05 ? h`<div><div class="fact-l">If nobody acts</div><div class="fact-v">about ${Math.max(1, Math.round(f.expectedDarkHours))} hours off air · ${fmt.k(f.exposureK)} in penalties</div></div>` : ''}
        <div class="hint">Based on this tower's own data: ZESCO power was on ${fmt.pct((r.gridAvailability14d || 0) * 100)} of the time over the last 2 weeks. We simulated the next 3 days ${f.runs} times.</div>
      </div>
      <div class="runway-chart">
        <div class="legend mb"><span class="src"><i style="background:var(--brand)"></i>Chance the tower is still on</span><span class="src"><i style="background:var(--crit);opacity:.4"></i>Chance it is dark in that hour</span></div>
        <div id="survival"></div>
      </div>`.s;
    Charts.survival(document.getElementById('survival'), f.survival, f.darkProbabilityByHour);
  }

  async function loadUtil() {
    const u = await Api.get(`/sites/${encodeURIComponent(siteId)}/power-utilization?period=${utilPeriod}`);
    if (App.stale(rid)) return;
    Charts.bars(document.getElementById('util'), u.utilization.map((x) => ({ label: SOURCE_LABEL[x.source] || x.source, value: x.pct, color: SOURCE_COLORS[x.source], valueLabel: `${x.pct.toFixed(0)}%` })), { max: 100, height: 170 });
    document.getElementById('util-note').textContent = `Share of ${fmt.int(u.hours)} hours by majority supply source.` + (u.coverageDays < u.periodDays - 0.5 ? ` Data covers ${u.coverageDays.toFixed(0)} of ${u.periodDays} days.` : '');
  }

  page.querySelectorAll('[data-scn]').forEach((b) => b.addEventListener('click', () => {
    scenario = b.dataset.scn;
    page.querySelectorAll('[data-scn]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    loadRunway().catch(Toast.error.bind(Toast));
  }));
  page.querySelectorAll('[data-util]').forEach((b) => b.addEventListener('click', () => {
    utilPeriod = b.dataset.util;
    page.querySelectorAll('[data-util]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    loadUtil().catch(Toast.error.bind(Toast));
  }));

  await loadRunway();
  let utilLoaded = false;
  document.getElementById('more').addEventListener('toggle', (e) => { if (e.target.open && !utilLoaded) { utilLoaded = true; loadUtil().catch(Toast.error.bind(Toast)); } });
  liveRefresh(['forecast', 'status'], () => loadRunway().catch(() => {}), 2000);
  const redraw = debounce(() => { if (!App.stale(rid)) { loadRunway().catch(() => {}); if (utilLoaded) loadUtil().catch(() => {}); Charts.timeline(document.getElementById('timeline'), tl.points, { deliveries: tl.deliveries, theft: tl.theft }); } }, 300);
  window.addEventListener('resize', redraw); window.addEventListener('themechange', redraw);
  App.onLeave(() => { window.removeEventListener('resize', redraw); window.removeEventListener('themechange', redraw); });
};
