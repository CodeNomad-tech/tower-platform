/* Fuel page, simplified: "Where is diesel going missing?"
   One sentence, one card per tower that is losing fuel (in plain words),
   everything else folded away. */
'use strict';

Pages.fuel = async function () {
  App.setTitle('Fuel');
  const page = document.getElementById('page');
  const rid = App.rid;
  let days = 30;

  const explain = (s) => ({
    theft_events: h`<b>${fmt.litres(s.breakdown.suddenDropsL)} disappeared in one go</b>${s.events[0] ? h` on ${fmt.dateTime(s.events[0].ts)}` : ''}, while the generator was switched off. Diesel doesn't vanish on its own, so this looks like <b>theft</b>.`,
    slow_siphoning: h`<b>About ${Math.round(s.breakdown.gradualOffGeneratorL / s.days)} litres go missing every day</b> while the generator is off. Small, regular losses like this usually mean <b>someone is siphoning fuel</b> (or there is a leak).`,
    excess_burn: h`<b>The generator is burning more diesel than it should</b> (${s.measuredBurnLph ? s.measuredBurnLph.toFixed(1) : '?'} litres an hour instead of ${s.nameplateBurnLph}). It probably <b>needs servicing</b>.`,
    unexplained: h`Some fuel is unaccounted for, but it doesn't match a clear pattern. <b>Check the delivery notes and the fuel sensor.</b>`,
  }[s.finding]);

  async function load() {
    const [r, { deliveries }, { sites }] = await Promise.all([Api.get(`/fuel/integrity?days=${days}`), Api.get('/fuel/deliveries'), Api.get('/sites')]);
    if (App.stale(rid)) return;
    const f = r.fleet;
    const losing = r.sites.filter((s) => s.unexplainedL > 0);
    const ok = r.sites.filter((s) => s.unexplainedL <= 0);
    const period = days === 7 ? 'this week' : days === 30 ? 'this month' : 'in the last 3 months';

    page.innerHTML = h`
      <div class="row between">
        <h2 class="hero-line">${losing.length
          ? h`<span style="color:var(--crit)">${fmt.k(f.unexplainedValueK)}</span> of diesel went missing ${period} at ${losing.length} tower${losing.length === 1 ? '' : 's'}.`
          : h`<span style="color:var(--ok)">All diesel is accounted for ${period}.</span>`}</h2>
        <div class="seg" role="group" aria-label="Period">${[[7, 'Week'], [30, 'Month'], [90, '3 months']].map(([d, l]) => h`<button type="button" data-days="${d}" aria-pressed="${d === days}">${l}</button>`)}</div>
      </div>
      <p class="muted" style="margin-top:-8px">We compare the diesel delivered with what the generator should have burned. Anything missing is shown below.</p>

      <div class="stack mt">${losing.map((s) => h`
        <article class="help-card l-${s.finding === 'excess_burn' || s.finding === 'unexplained' ? 'orange' : 'red'}">
          <div class="help-head">
            <span class="dot-l l-${s.finding === 'excess_burn' || s.finding === 'unexplained' ? 'orange' : 'red'}"></span>
            <div><h3>${s.name}</h3><div class="small dim">${s.region}</div></div>
            <span class="help-money">${fmt.litres(s.unexplainedL)} · ${fmt.k(s.unexplainedValueK)}</span>
          </div>
          <p class="help-text">${explain(s)}</p>
          <a class="btn" href="#/site/${encodeURIComponent(s.siteId)}">See tower</a>
        </article>`)}</div>

      ${ok.length ? h`<div class="fine-line"><span class="small" style="color:var(--ok);font-weight:600">${ok.length} tower${ok.length === 1 ? '' : 's'} with no missing fuel:</span>
        <div class="chips">${ok.map((s) => h`<a class="chip" href="#/site/${encodeURIComponent(s.siteId)}"><span class="dot-l l-green"></span>${s.name}</a>`)}</div></div>` : ''}

      ${Api.can('operator') ? h`<section class="card mt"><div class="card-h"><h2>Record a fuel delivery</h2></div><div class="card-b">
        <form id="deliv" class="form-row">
          <div class="field"><label for="d-site">Tower</label><select class="input" id="d-site" name="siteId" required>${sites.filter((s) => s.gen_kw > 0).map((s) => h`<option value="${s.id}">${s.name}</option>`)}</select></div>
          <div class="field"><label for="d-l">Litres</label><input class="input" id="d-l" name="litres" type="number" min="1" required></div>
          <div class="field"><label for="d-ref">Delivery note number</label><input class="input" id="d-ref" name="reference" maxlength="60"></div>
          <button class="btn primary" type="submit">Save delivery</button>
        </form></div></section>` : ''}

      <details class="more mt">
        <summary>Show the full fuel accounting and delivery history</summary>
        <section class="card mt">
          <div class="card-h"><h3>Fuel accounting per tower</h3><button class="btn sm" id="csv">${ICONS.download} Download</button></div>
          <div class="card-b flush"><div class="table-wrap"><table>
            <thead><tr><th>Tower</th><th class="num">At start</th><th class="num">+ Delivered</th><th class="num">− Should have burned</th><th class="num">− Left now</th><th class="num">= Missing</th></tr></thead>
            <tbody>${r.sites.map((s) => h`<tr><td>${s.name}</td><td class="num">${fmt.litres(s.openingL)}</td><td class="num">${fmt.litres(s.deliveredL)}</td><td class="num">${fmt.litres(s.expectedBurnL)}</td><td class="num">${fmt.litres(s.closingL)}</td>
              <td class="num"><b style="${s.unexplainedL > 0 ? 'color:var(--crit)' : ''}">${fmt.litres(Math.max(0, s.unexplainedL))}</b></td></tr>`)}</tbody></table></div></div>
          <p class="hint" style="padding:0 16px 12px">"Should have burned" = hours the generator ran × its official fuel use per hour. Small differences under 2% of the tank are treated as sensor noise.</p>
        </section>
        <section class="card mt"><div class="card-h"><h3>Recent deliveries</h3></div>
          <div class="card-b flush">${deliveries.length ? h`<div class="table-wrap"><table><tbody>${deliveries.slice(0, 15).map((d) => h`<tr><td class="small nowrap">${fmt.dateTime(d.ts)}</td><td>${d.site_name}</td><td class="num">${fmt.litres(d.litres)}</td><td class="small dim">${d.reference || ''}</td></tr>`)}</tbody></table></div>` : empty('No deliveries recorded')}</div></section>
      </details>`.s;

    page.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { days = Number(b.dataset.days); load(); }));
    document.getElementById('csv').addEventListener('click', () => Api.download(`/reports/export/fuel.csv?days=${days}`, `toweriq-fuel-${days}d.csv`).catch(Toast.error.bind(Toast)));
    const form = document.getElementById('deliv');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await Api.post('/fuel/deliveries', { siteId: fd.get('siteId'), litres: Number(fd.get('litres')), reference: fd.get('reference') || null });
        Toast.show('Delivery saved', `${fd.get('litres')} litres`, 'ok');
        load();
      } catch (err) { Toast.error(err); }
    });
  }
  await load();
};
