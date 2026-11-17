/* Home screen ("Overview"). Deliberately minimal:
   1. one sentence saying how the fleet is,
   2. a map of Zambia with every tower as a coloured dot,
   3. a short list of the towers that need help, each in plain words with one clear action.
   Everything else lives on other pages. */
'use strict';

// Plain-language helpers ------------------------------------------------------
const Plain = {
  // "in about 30 hours (tomorrow ~16:00)"
  when(hours) {
    if (hours == null) return 'not in the next 3 days';
    if (hours < 1) return 'within the hour';
    const t = new Date(Date.now() + hours * 3600000);
    const today = new Date(); const tom = new Date(Date.now() + 86400000);
    const day = t.toDateString() === today.toDateString() ? 'today' : t.toDateString() === tom.toDateString() ? 'tomorrow' : t.toLocaleDateString('en-GB', { weekday: 'long' });
    const hh = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const rough = hours < 48 ? `${Math.round(hours)} hours` : `${(hours / 24).toFixed(1)} days`;
    return `in about ${rough} (${day} ~${hh})`;
  },
  // Traffic-light state for a site, used by map dots and cards.
  light(risk) { return risk === 'dark' || risk === 'critical' ? 'red' : risk === 'high' || risk === 'watch' ? 'orange' : 'green'; },
};

Pages.command = async function () {
  App.setTitle('Overview');
  const page = document.getElementById('page');
  const rid = App.rid;
  let showFine = false;

  async function load() {
    const [runway, actions, exec] = await Promise.all([
      Api.get('/resilience/runway'), Api.get('/resilience/actions'), Api.get('/reports/executive-summary'),
    ]);
    if (App.stale(rid)) return;
    page.innerHTML = render(runway, actions, exec).s;
    bind();
  }

  // One card per site that needs help (actions grouped by site, most urgent first).
  function helpCards(runway, actions) {
    const bySite = new Map();
    for (const a of actions.actions) { if (!bySite.has(a.siteId)) bySite.set(a.siteId, []); bySite.get(a.siteId).push(a); }
    return [...bySite.entries()].map(([siteId, acts]) => ({ site: runway.sites.find((s) => s.siteId === siteId), acts }));
  }

  function sentence(a, s) {
    const f = s?.forecast;
    if (a.kind === 'restore') return h`<b>This tower is off air right now.</b> Phones in the area have no signal. ${a.litres ? `Send ${a.litres} litres of diesel immediately.` : 'Send a mobile generator.'}`;
    if (a.kind === 'refuel') return h`<b>It will run out of diesel ${Plain.when(f?.medianTimeToDarkH ?? f?.fuelOutMedianH)}.</b> A fuel truck takes about ${s.assets.refuel_lead_h} hours to get there, so <b>order ${a.litres} litres ${fmt.until(a.deadline).over ? 'now' : Plain.when((Date.parse(a.deadline) - Date.now()) / 3600000)}</b>.`;
    if (a.kind === 'capacity') return h`<b>Its battery can't last through the power cuts</b>, and it has no generator to fall back on. Expect it to go dark ${Plain.when(f?.medianTimeToDarkH)}. Bring a mobile generator.`;
    if (a.kind === 'alarm') return h`<b>${a.detail}</b>. Someone should check the site.`;
    return h`${a.detail}`;
  }

  function card({ site, acts }) {
    const a = acts[0];
    const light = a.kind === 'alarm' ? 'red' : Plain.light(site?.risk);
    return h`
      <article class="help-card l-${light}">
        <div class="help-head">
          <span class="dot-l l-${light}" aria-hidden="true"></span>
          <div><h3>${a.siteName}</h3><div class="small dim">${site?.region || ''}</div></div>
          ${a.valueK ? h`<span class="help-money" title="${a.basis}">${fmt.k(a.valueK)} at stake</span>` : ''}
        </div>
        <p class="help-text">${sentence(a, site)}</p>
        ${acts.length > 1 ? h`<p class="small muted">Also: ${acts.slice(1).map((x) => x.title).join('; ')}</p>` : ''}
        <div class="row">
          ${(a.kind === 'refuel' || (a.kind === 'restore' && a.litres)) && Api.can('operator')
            ? h`<form class="row" data-deliver="${a.siteId}"><input class="input" name="litres" type="number" min="1" value="${a.litres}" aria-label="Litres delivered" style="width:100px"><button class="btn primary" type="submit">Fuel delivered</button></form>` : ''}
          ${a.kind === 'alarm' && Api.can('operator') ? h`<button class="btn primary" data-ack="${a.alertId}">I'm on it</button>` : ''}
          <a class="btn" href="#/site/${encodeURIComponent(a.siteId)}">See tower</a>
        </div>
      </article>`;
  }

  function map(runway, needIds) {
    const z = ZAMBIA;
    const dots = runway.sites.filter((s) => s.latitude != null).map((s) => {
      const [x, y] = z.xy(s.longitude, s.latitude);
      const l = needIds.has(s.siteId) && Plain.light(s.risk) === 'green' ? 'orange' : Plain.light(s.risk);
      const label = l !== 'green';
      return `<a href="#/site/${encodeURIComponent(s.siteId)}" aria-label="${esc(s.name)}: ${l === 'green' ? 'fine' : l === 'orange' ? 'needs attention' : 'urgent'}">
        <title>${esc(s.name)}</title>
        ${l !== 'green' ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16" class="ring l-${l}"/>` : ''}
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${label ? 9 : 7}" class="pin l-${l}"/>
      </a>`;
    }).join('');
    // Labels go in a separate layer above every dot so neighbouring towers never cover them.
    const labels = runway.sites.filter((s) => s.latitude != null).map((s) => {
      const l = needIds.has(s.siteId) && Plain.light(s.risk) === 'green' ? 'orange' : Plain.light(s.risk);
      if (l === 'green') return '';
      const [x, y] = z.xy(s.longitude, s.latitude);
      return `<text x="${(x + 14).toFixed(1)}" y="${(y + 5).toFixed(1)}" class="pin-label" aria-hidden="true">${esc(s.name)}</text>`;
    }).join('');
    return raw(`<svg class="map" viewBox="-10 -10 ${z.W + 120} ${z.H + 20}" role="img" aria-label="Map of Zambia showing each tower's status">
      <path d="${z.path}" class="land"/>${dots}<g style="pointer-events:none">${labels}</g></svg>`);
  }

  function render(runway, actions, exec) {
    const cards = helpCards(runway, actions);
    const needIds = new Set(cards.map((c) => c.site?.siteId || c.acts[0].siteId));
    const fine = runway.sites.filter((s) => !needIds.has(s.siteId));
    const n = cards.length;
    const head = n === 0
      ? h`<h2 class="hero-line ok">All ${runway.sites.length} towers are fine for the next 3 days.</h2>`
      : h`<h2 class="hero-line">${n} of ${runway.sites.length} towers need your attention.</h2>`;
    return h`
      ${head}
      <div class="overview">
        <section class="card map-card" aria-label="Map">
          <div class="card-b">${map(runway, needIds)}
            <div class="legend map-legend">
              <span><span class="dot-l l-green"></span>Fine</span>
              <span><span class="dot-l l-orange"></span>Needs attention</span>
              <span><span class="dot-l l-red"></span>Urgent or off air</span>
            </div>
          </div>
        </section>
        <section aria-label="Towers that need help">
          <div class="stack">${n ? cards.map(card) : h`<div class="card card-b">${empty('Nothing to do right now', 'Every tower has enough fuel and battery for the next 3 days.')}</div>`}</div>
          <div class="fine-line">
            <button type="button" class="linkish" data-toggle-fine aria-expanded="${showFine}">${fine.length} other tower${fine.length === 1 ? ' is' : 's are'} fine ${showFine ? '▴' : '▾'}</button>
            ${showFine ? h`<div class="chips">${fine.map((s) => h`<a class="chip" href="#/site/${encodeURIComponent(s.siteId)}"><span class="dot-l l-green"></span>${s.name}</a>`)}</div>` : ''}
          </div>
        </section>
      </div>
      <div class="strip">
        <span>Off air now: <b>${runway.fleet.darkNow}</b></span>
        <span>Uptime this month: <b>${fmt.pct(exec.availability30d, 1)}</b></span>
        <span>Diesel missing this month: <b>${fmt.k(exec.fuelUnexplainedK30d)}</b> <a href="#/fuel">why?</a></span>
        <span class="dim">Simulated demo data</span>
      </div>`;
  }

  function bind() {
    page.querySelector('[data-toggle-fine]')?.addEventListener('click', () => { showFine = !showFine; load(); });
    page.querySelectorAll('form[data-deliver]').forEach((form) => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const litres = Number(new FormData(form).get('litres'));
      const btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await Api.post('/fuel/deliveries', { siteId: form.dataset.deliver, litres, reference: 'Logged from Overview' });
        Toast.show('Delivery recorded', `${litres} litres at ${form.dataset.deliver}. The tower's status updates within a few seconds.`, 'ok');
        setTimeout(load, 11000);
      } catch (err) { Toast.error(err); btn.disabled = false; btn.textContent = 'Fuel delivered'; }
    }));
    page.querySelectorAll('[data-ack]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await Api.post(`/alerts/${b.dataset.ack}/acknowledge`); Toast.show('Noted', 'Alarm marked as being handled.', 'ok'); load(); } catch (err) { Toast.error(err); b.disabled = false; }
    }));
  }

  await load();
  liveRefresh(['alert', 'status', 'forecast'], load, 2000);
};
