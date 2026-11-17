/* Command Center: answers "what needs my attention, and what do I do first?" in one screen. */
'use strict';

Pages.command = async function () {
  App.setTitle('Command Center');
  const page = document.getElementById('page');
  const rid = App.rid;

  async function load() {
    const [runway, actions, exec] = await Promise.all([
      Api.get('/resilience/runway'), Api.get('/resilience/actions'), Api.get('/reports/executive-summary'),
    ]);
    if (App.stale(rid)) return;
    page.innerHTML = render(runway, actions, exec).s;
    bind();
  }

  function headline(runway, actions) {
    const f = runway.fleet;
    const atRisk = runway.sites.filter((s) => s.risk === 'critical' || s.risk === 'high');
    if (f.darkNow || atRisk.length) {
      const names = [...runway.sites.filter((s) => s.risk === 'dark'), ...atRisk].slice(0, 3).map((s) => s.name);
      return h`
        <div class="headline" role="status">
          <div class="headline-icon">${ICONS.warn}</div>
          <div>
            <div class="big">${f.darkNow ? h`<em>${f.darkNow} tower${f.darkNow > 1 ? 's' : ''} dark now.</em> ` : ''}
              <em>${atRisk.length} tower${atRisk.length === 1 ? '' : 's'}</em> likely to go dark in the next 72 h${names.length ? ': ' + names.join(', ') : ''}.</div>
            <div class="why">${actions.actions.length} recommended action${actions.actions.length === 1 ? '' : 's'} below protect an estimated <b>${fmt.k(actions.totalValueK)}</b> in SLA credits and diesel.
              Forecast: ${runway.sites.length} sites × 200 simulations each under the grid pattern each site learned over the last 14 days.</div>
          </div>
        </div>`;
    }
    return h`
      <div class="headline"><div class="headline-icon okc">${ICONS.check}</div>
        <div><div class="big"><em class="okc">All ${f.sites} towers</em> are expected to stay powered for the next 72 hours.</div>
        <div class="why">No blackout risk above tolerance. ${f.onBackup} sites are currently running on backup power.</div></div></div>`;
  }

  function actionHtml(a) {
    const d = fmt.until(a.deadline);
    const canDeliver = a.kind === 'refuel' || (a.kind === 'restore' && a.litres);
    return h`
      <div class="action p-${a.priority}" id="act-${a.id.replace(/[^a-z0-9]/gi, '_')}">
        <div class="bar"></div>
        <div>
          <div class="action-title">${a.title}</div>
          <div class="action-detail">${a.detail}</div>
          <div class="action-meta">
            ${a.valueK ? h`<span>Value protected <b>${fmt.k(a.valueK)}</b></span>` : ''}
            <span title="${a.basis}">Basis: ${a.basis}</span>
          </div>
        </div>
        <div class="action-side">
          <span class="badge ${a.priority === 'critical' ? 'b-crit' : a.priority === 'high' ? 'b-high' : 'b-watch'}">${fmt.label(a.priority)}</span>
          <span class="deadline ${d.over ? 'over' : ''}">${a.kind === 'alarm' ? 'Respond ' : 'Act '}${d.text}</span>
          <a class="btn sm" href="#/site/${encodeURIComponent(a.siteId)}">Open site</a>
        </div>
        ${canDeliver && Api.can('operator') ? h`
          <form class="action-form" data-deliver="${a.siteId}">
            <label class="small muted" for="l-${a.siteId}">Delivery arrived?</label>
            <input class="input" id="l-${a.siteId}" name="litres" type="number" min="1" step="1" value="${a.litres || ''}" aria-label="Litres delivered">
            <button class="btn sm primary" type="submit">Log delivery</button>
          </form>` : ''}
        ${a.kind === 'alarm' && Api.can('operator') ? h`<div class="action-form"><button class="btn sm" data-ack="${a.alertId}">Acknowledge alarm</button></div>` : ''}
      </div>`;
  }

  function siteRow(s) {
    const f = s.forecast;
    const ttd = s.risk === 'dark' ? h`<div class="v" style="color:var(--crit)">Dark</div><div class="p">${fmt.k(s.exposurePerDarkHourK)}/h exposure</div>`
      : f.medianTimeToDarkH != null ? h`<div class="v" style="color:${s.risk === 'critical' ? 'var(--crit)' : 'var(--high)'}">${fmt.hours(f.medianTimeToDarkH)}</div><div class="p">${fmt.pct(f.pDark24h * 100)} risk in 24 h</div>`
        : f.pDark72h > 0.02 ? h`<div class="v">&gt; 72 h</div><div class="p">${fmt.pct(f.pDark72h * 100)} risk in 72 h</div>`
          : h`<div class="v" style="color:var(--ok)">Secure</div><div class="p">&gt; 72 h runway</div>`;
    return h`
      <a class="site-row" href="#/site/${encodeURIComponent(s.siteId)}">
        <div><div class="nm">${s.name}</div><div class="rg">${s.siteId} · ${s.region}</div></div>
        <div>${riskBadge(s.risk)}</div>
        <div class="mini hide-sm">${srcTag(s.state.activeSource)}<span>${s.state.gridUp ? 'Grid available' : 'Grid off'}</span></div>
        <div class="mini hide-sm">
          ${s.assets.gen_kw > 0 ? h`<span>Fuel ${fmt.pct(s.state.fuelPct)} · ${fmt.litres(s.state.fuelL)}</span>${meter(s.state.fuelPct)}` : h`<span>No generator</span>`}
          ${s.assets.battery_kwh > 0 ? h`<span>Battery ${fmt.pct(s.state.socPct)}</span>${meter(s.state.socPct)}` : ''}
        </div>
        <div class="ttd">${ttd}</div>
      </a>`;
  }

  function render(runway, actions, exec) {
    const f = runway.fleet;
    return h`
      ${headline(runway, actions)}
      <div class="grid g4 mt">
        <div class="card kpi ${f.darkNow ? 'crit' : 'ok'}"><div class="kpi-label">Towers dark now</div><div class="kpi-value">${f.darkNow} <span class="small muted">/ ${f.sites}</span></div><div class="kpi-sub">${f.onBackup} on backup · ${f.onGrid} on grid</div></div>
        <div class="card kpi ${f.atRisk24h ? 'high' : 'ok'}"><div class="kpi-label">Blackout risk ≥15% in 24 h</div><div class="kpi-value">${f.atRisk24h}</div><div class="kpi-sub">${fmt.k(f.exposureK72h)} expected SLA exposure (72 h)</div></div>
        <div class="card kpi ${exec.slaCompliant < exec.totalSites ? 'high' : 'ok'}"><div class="kpi-label">Availability, last 30 days</div><div class="kpi-value">${fmt.pct(exec.availability30d, 2)}</div><div class="kpi-sub">${exec.slaCompliant}/${exec.totalSites} sites meet SLA · ${fmt.int(exec.downtimeHours30d)} h down</div></div>
        <div class="card kpi ${exec.fuelUnexplainedL30d > 0 ? 'crit' : 'ok'}"><div class="kpi-label">Unexplained diesel loss, 30 days</div><div class="kpi-value">${fmt.k(exec.fuelUnexplainedK30d)}</div><div class="kpi-sub">${fmt.litres(exec.fuelUnexplainedL30d)} · <a href="#/fuel">see where</a></div></div>
      </div>

      <div class="grid g-side mt">
        <section class="card" aria-labelledby="h-actions">
          <div class="card-h"><h2 id="h-actions">Do this next</h2><span class="sub">Ranked by urgency, then deadline</span></div>
          <div class="card-b flush">${actions.actions.length ? actions.actions.map(actionHtml) : empty('Nothing needs action', 'Every site has enough fuel and backup for the next 72 hours.')}</div>
        </section>
        <section class="card" aria-labelledby="h-runway">
          <div class="card-h"><h2 id="h-runway">Fleet runway</h2><span class="sub">Time until each tower goes dark if nobody acts</span></div>
          <div class="card-b flush">
            <div class="site-head"><span>Site</span><span>Risk</span><span class="hide-sm">Supply now</span><span class="hide-sm">Fuel / battery</span><span style="text-align:right">Runway</span></div>
            ${runway.sites.map(siteRow)}
          </div>
        </section>
      </div>

      <section class="card mt" aria-labelledby="h-feed">
        <div class="card-h"><h2 id="h-feed">Live events</h2><span class="sub">Power switches, generator starts and alarms as they happen</span></div>
        <div class="card-b flush feed" id="feed">${feedHtml()}</div>
      </section>`;
  }

  function feedHtml() {
    if (!Live.feed.length) return empty('Waiting for events', 'Telemetry streams every 10 seconds. Switches and alarms appear here.');
    return raw(Live.feed.slice(0, 30).map((e) => h`<div class="feed-item"><time>${e.t.toLocaleTimeString('en-GB')}</time><span style="${e.tone === 'critical' ? 'color:var(--crit)' : e.tone === 'ok' ? 'color:var(--ok)' : ''}">${e.text}</span></div>`.s).join(''));
  }

  function bind() {
    page.querySelectorAll('form[data-deliver]').forEach((form) => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const litres = Number(new FormData(form).get('litres'));
      const btn = form.querySelector('button'); btn.disabled = true;
      try {
        await Api.post('/fuel/deliveries', { siteId: form.dataset.deliver, litres, reference: 'Logged from Command Center' });
        Toast.show('Delivery logged', `${litres} L at ${form.dataset.deliver}. Runway recalculates on the next telemetry tick.`, 'ok');
        setTimeout(load, 11000);
      } catch (err) { Toast.error(err); btn.disabled = false; }
    }));
    page.querySelectorAll('[data-ack]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await Api.post(`/alerts/${b.dataset.ack}/acknowledge`); Toast.show('Alarm acknowledged', '', 'ok'); load(); } catch (err) { Toast.error(err); b.disabled = false; }
    }));
  }

  await load();
  liveRefresh(['alert', 'status', 'forecast'], load, 2000);
  App.onLeave(Live.on(() => { const el = document.getElementById('feed'); if (el) el.innerHTML = feedHtml().s; }));
};
