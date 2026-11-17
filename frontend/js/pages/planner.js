/* Resilience Planner, simplified:
   "If power cuts get worse, where should we spend money on batteries and solar?"
   One question, two controls, one-sentence answer, a short ranked list.
   The full per-site comparison is folded away. */
'use strict';

Pages.planner = async function () {
  App.setTitle('Upgrade Planner');
  const page = document.getElementById('page');
  const rid = App.rid;
  const st = { hours: 12, budget: 600000, learned: false };

  page.innerHTML = h`
    <h2 class="hero-line">Where should we put batteries and solar first?</h2>
    <section class="card">
      <div class="card-b planner-controls">
        <div class="field">
          <label for="ls">Power cuts per day</label>
          <div class="row"><span class="scenario-val" id="ls-val"></span>
            <label class="small muted row" style="gap:6px"><input type="checkbox" id="learned"> use each tower's usual cuts instead</label></div>
          <input type="range" id="ls" min="0" max="20" step="1" value="${st.hours}">
          <div class="hint">For reference: ZESCO cut power 8 hours a day in March 2024, 12 in May and 17 in September.</div>
        </div>
        <div class="field">
          <label for="budget">Money available (Kwacha)</label>
          <input class="input" id="budget" type="number" min="0" step="50000" value="${st.budget}">
        </div>
        <div class="row"><button class="btn" id="csv">${ICONS.download} Download plan</button></div>
      </div>
    </section>
    <div id="out" class="mt"><div class="skeleton"></div></div>`.s;

  const ls = document.getElementById('ls'), lsVal = document.getElementById('ls-val'), learned = document.getElementById('learned'), budget = document.getElementById('budget');
  const query = () => `loadShedding=${st.learned ? 'learned' : st.hours}&budget=${st.budget}`;
  const paint = () => { lsVal.textContent = st.learned ? "Each tower's usual" : `${st.hours} hours`; ls.disabled = st.learned; };
  paint();

  async function load() {
    const out = document.getElementById('out');
    out.style.opacity = '0.55';
    const p = await Api.get('/resilience/plan?' + query());
    if (App.stale(rid)) return;
    out.style.opacity = '';
    const f = p.fleet;
    const funded = p.plan.filter((x) => x.funded);
    const before = Math.round(f.darkHoursPerMonthBefore), after = Math.round(f.darkHoursPerMonthAfter);

    const answer = !p.plan.length
      ? h`With this much power cutting, no battery or solar upgrade pays for itself within 4 years. The towers already cope.`
      : h`Spending <b>${fmt.kShort(f.capexK)}</b> on <b>${funded.length} tower${funded.length === 1 ? '' : 's'}</b>
          ${before > 0 ? h`cuts the time towers are off air from <b>${before} hour${before === 1 ? '' : 's'}</b> to <b>${after} hour${after === 1 ? '' : 's'}</b> a month,` : ''}
          saves about <b>${fmt.kShort(f.monthlyBenefitK)} a month</b> in diesel and penalties,
          and ${f.paybackMonths ? h`pays for itself in about <b>${Math.round(f.paybackMonths)} months</b>` : 'does not pay back'}.`;

    out.innerHTML = h`
      <div class="answer card card-b">${answer}</div>

      <h2 class="section">Recommended upgrades, best value first</h2>
      <div class="stack">${p.plan.length ? p.plan.slice(0, 8).map((x, i) => {
        const s = p.sites.find((y) => y.siteId === x.siteId);
        const o = x.option;
        const why = o.avoidedDarkH >= 1
          ? h`Stops about <b>${Math.round(o.avoidedDarkH)} hours</b> of blackout a month${o.dieselSavedL > 20 ? h` and saves ${fmt.litres(o.dieselSavedL)} of diesel` : ''}.`
          : h`Saves about <b>${fmt.litres(o.dieselSavedL)} of diesel a month</b>: the generator runs less because the battery covers more of each power cut.`;
        return h`
          <article class="plan-row ${x.funded ? '' : 'unfunded'}">
            <div class="plan-rank">${i + 1}</div>
            <div class="plan-main">
              <div class="row"><b><a href="#/site/${encodeURIComponent(x.siteId)}">${x.name}</a></b><span class="dim small">${s.region}</span>
                ${x.funded ? '' : h`<span class="badge b-neutral plain">Over budget</span>`}</div>
              <div><b>${({ battery: 'Add a 10 kWh battery', solar: 'Add 4 kWp of solar panels', hybrid: 'Add 4 kWp of solar panels and a 10 kWh battery' })[o.key] || o.label}</b>. ${why}</div>
            </div>
            <div class="plan-nums">
              <div><span class="dim small">Cost</span><b>${fmt.k(o.capexK)}</b></div>
              <div><span class="dim small">Saves / month</span><b>${fmt.k(o.monthlyBenefitK)}</b></div>
              <div><span class="dim small">Pays back</span><b>${Math.round(o.paybackMonths)} months</b></div>
            </div>
          </article>`;
      }) : empty('Nothing worth buying under this scenario', 'Try more hours of power cuts.')}</div>

      <details class="more mt">
        <summary>Show every tower's numbers</summary>
        <div class="card mt"><div class="table-wrap"><table>
          <thead><tr><th>Tower</th><th class="num">Uptime with today's equipment</th><th class="num">Hours off air / month</th><th class="num">Diesel / month</th>${p.sites[0]?.options.map((o) => h`<th class="num">${o.label}<div class="dim small">hours saved · payback</div></th>`)}</tr></thead>
          <tbody>${p.sites.map((s) => h`<tr>
            <td><a href="#/site/${encodeURIComponent(s.siteId)}">${s.name}</a></td>
            <td class="num" style="color:${s.baseline.availabilityPct < 99.5 ? 'var(--crit)' : ''}">${fmt.pct(s.baseline.availabilityPct, 1)}</td>
            <td class="num">${Math.round(s.baseline.darkHours)}</td>
            <td class="num">${fmt.litres(s.baseline.dieselL)}</td>
            ${s.options.map((o) => h`<td class="num small ${s.best && s.best.key === o.key ? '' : 'muted'}">${Math.round(o.avoidedDarkH)} h · ${o.paybackMonths ? (o.paybackMonths > 99 ? '>99' : Math.round(o.paybackMonths)) + ' mo' : 'n/a'}${s.best && s.best.key === o.key ? raw(' ✓') : ''}</td>`)}
          </tr>`)}</tbody></table></div></div>
        <p class="hint">How this works: each tower is simulated for a month with its own equipment, its usual refuel times and the chosen power cuts, then again with each upgrade. Prices used: diesel ${fmt.k(p.assumptions.dieselPriceK)}/L, battery ${fmt.k(p.assumptions.batteryCostKPerKwh)}/kWh, solar ${fmt.k(p.assumptions.solarCostKPerKw)}/kWp. These are placeholders an admin can change in Settings.</p>
      </details>`.s;
  }

  const reload = debounce(() => load().catch(Toast.error.bind(Toast)), 250);
  ls.addEventListener('input', () => { st.hours = Number(ls.value); paint(); reload(); });
  learned.addEventListener('change', () => { st.learned = learned.checked; paint(); reload(); });
  budget.addEventListener('input', () => { const v = Number(budget.value); if (v >= 0) { st.budget = v; reload(); } });
  document.getElementById('csv').addEventListener('click', () => Api.download('/resilience/plan.csv?' + query(), 'toweriq-upgrade-plan.csv').catch(Toast.error.bind(Toast)));
  await load();
};
