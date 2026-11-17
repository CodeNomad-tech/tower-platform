/* Resilience Planner: "With this budget, under this much load-shedding,
   which upgrades remove the most downtime per Kwacha?" Produces the ranked,
   costed redundancy plan (CSV) that a regulator directive asks for. */
'use strict';

Pages.planner = async function () {
  App.setTitle('Resilience Planner');
  const page = document.getElementById('page');
  const rid = App.rid;
  const st = { mode: 'scenario', hours: 12, budget: 600000 };

  page.innerHTML = h`
    <div class="notice mb">
      <b>What this answers:</b> under a given load-shedding level, how many hours each tower would be dark over the next month,
      and which battery/solar upgrade at which site removes the most downtime and diesel per Kwacha invested.
      Each figure comes from a 30-day simulation of the site's own power model with a realistic refuel policy.
    </div>
    <section class="card">
      <div class="card-b planner-controls">
        <div class="field">
          <label for="ls">Load-shedding scenario</label>
          <div class="row"><span class="scenario-val" id="ls-val"></span>
            <label class="small muted row" style="gap:6px"><input type="checkbox" id="learned"> Use each site's learned pattern instead</label></div>
          <input type="range" id="ls" min="0" max="20" step="1" value="${st.hours}" aria-describedby="ls-hint">
          <div class="hint" id="ls-hint">ZESCO cuts in 2024 ran from 8 h/day (March) to 12 h (May) and 17 h (September).</div>
        </div>
        <div class="field">
          <label for="budget">Capital budget (Kwacha)</label>
          <input class="input" id="budget" type="number" min="0" step="50000" value="${st.budget}">
          <div class="hint">Upgrades are funded in order of benefit per Kwacha.</div>
        </div>
        <div class="row"><button class="btn" id="csv">${ICONS.download} Export plan CSV</button></div>
      </div>
    </section>
    <div id="out" class="mt"><div class="skeleton"></div></div>`.s;

  const ls = document.getElementById('ls'), lsVal = document.getElementById('ls-val'), learned = document.getElementById('learned'), budget = document.getElementById('budget');
  const query = () => `loadShedding=${st.mode === 'learned' ? 'learned' : st.hours}&budget=${st.budget}`;
  const paintLabel = () => { lsVal.textContent = st.mode === 'learned' ? 'Learned (last 14 days)' : `${st.hours} h/day`; ls.disabled = st.mode === 'learned'; };
  paintLabel();

  async function load() {
    const out = document.getElementById('out');
    out.style.opacity = '0.55';
    const p = await Api.get('/resilience/plan?' + query());
    if (App.stale(rid)) return;
    out.style.opacity = '';
    const f = p.fleet;
    const reduction = f.darkHoursPerMonthBefore > 0 ? (1 - f.darkHoursPerMonthAfter / f.darkHoursPerMonthBefore) * 100 : 0;
    const funded = p.plan.filter((x) => x.funded);
    out.innerHTML = h`
      <div class="grid g4">
        <div class="card kpi"><div class="kpi-label">Fleet dark hours per month</div>
          <div class="compare"><span class="from">${fmt.int(f.darkHoursPerMonthBefore)} h</span><span class="to">${fmt.int(f.darkHoursPerMonthAfter)} h</span></div>
          <div class="kpi-sub">${f.darkHoursPerMonthBefore > 0 ? `${reduction.toFixed(0)}% less downtime with the funded plan` : 'No blackouts expected under this scenario'}</div></div>
        <div class="card kpi"><div class="kpi-label">Capital required</div><div class="kpi-value">${fmt.kShort(f.capexK)}</div><div class="kpi-sub">${f.sitesFunded} site upgrade${f.sitesFunded === 1 ? '' : 's'} within ${fmt.kShort(p.budgetK)}</div></div>
        <div class="card kpi ok"><div class="kpi-label">Monthly benefit</div><div class="kpi-value">${fmt.kShort(f.monthlyBenefitK)}</div><div class="kpi-sub">SLA credits avoided + diesel saved</div></div>
        <div class="card kpi"><div class="kpi-label">Fleet payback</div><div class="kpi-value">${f.paybackMonths ? f.paybackMonths.toFixed(1) + ' mo' : '—'}</div><div class="kpi-sub">Computed in ${p.computeMs} ms</div></div>
      </div>

      <section class="card mt">
        <div class="card-h"><h2>Ranked upgrade plan</h2><span class="sub">Scenario: ${p.scenario}. Only upgrades that pay back within 4 years are recommended.</span></div>
        <div class="card-b flush"><div class="table-wrap">${p.plan.length ? h`<table>
          <thead><tr><th>#</th><th>Site</th><th>Recommended upgrade</th><th class="num">Capex</th><th class="num">Dark h/month now</th><th class="num">Dark h avoided</th><th class="num">Diesel saved/month</th><th class="num">Benefit/month</th><th class="num">Payback</th><th></th></tr></thead>
          <tbody>${p.plan.map((x, i) => {
            const s = p.sites.find((y) => y.siteId === x.siteId);
            return h`<tr class="link" data-href="#/site/${encodeURIComponent(x.siteId)}" style="${x.funded ? '' : 'opacity:.55'}">
              <td class="num">${i + 1}</td><td><b>${x.name}</b><div class="small dim">${s.region} · grid group ${s.current.grid_profile}</div></td>
              <td>${x.option.label}<div class="small dim">now: ${s.current.battery_kwh} kWh battery, ${s.current.solar_kw} kWp solar${s.current.gen_kw ? '' : ', no generator'}</div></td>
              <td class="num">${fmt.k(x.option.capexK)}</td>
              <td class="num">${s.baseline.darkHours.toFixed(1)}</td>
              <td class="num" style="color:${x.option.avoidedDarkH > 0 ? 'var(--ok)' : ''}">${x.option.avoidedDarkH.toFixed(1)}</td>
              <td class="num">${fmt.litres(x.option.dieselSavedL)}</td>
              <td class="num"><b>${fmt.k(x.option.monthlyBenefitK)}</b></td>
              <td class="num">${x.option.paybackMonths.toFixed(1)} mo</td>
              <td>${x.funded ? h`<span class="badge b-ok">Funded</span>` : h`<span class="badge b-neutral">Over budget</span>`}</td>
            </tr>`;
          })}</tbody></table>` : empty('No upgrade pays back under this scenario', 'Try a heavier load-shedding scenario or check the cost assumptions in Settings.')}</div></div>
      </section>

      <section class="card mt">
        <div class="card-h"><h2>Every site under this scenario</h2><span class="sub">Baseline: today's equipment, with refuelling triggered at ${p.assumptions.refuelTriggerPct}% and each site's lead time</span></div>
        <div class="card-b flush"><div class="table-wrap"><table>
          <thead><tr><th>Site</th><th class="num">Projected availability</th><th class="num">Dark h/month</th><th class="num">Diesel/month</th>${p.sites[0]?.options.map((o) => h`<th class="num">${o.label}<div class="dim small">dark h avoided · payback</div></th>`)}</tr></thead>
          <tbody>${p.sites.map((s) => h`<tr>
            <td><a href="#/site/${encodeURIComponent(s.siteId)}">${s.name}</a></td>
            <td class="num" style="color:${s.baseline.availabilityPct < 99.5 ? 'var(--crit)' : ''}">${fmt.pct(s.baseline.availabilityPct, 2)}</td>
            <td class="num">${s.baseline.darkHours.toFixed(1)}</td>
            <td class="num">${fmt.litres(s.baseline.dieselL)}</td>
            ${s.options.map((o) => h`<td class="num small ${s.best && s.best.key === o.key ? '' : 'muted'}">${o.avoidedDarkH.toFixed(1)} h · ${o.paybackMonths ? (o.paybackMonths > 99 ? '>99' : o.paybackMonths.toFixed(0)) + ' mo' : 'n/a'}${s.best && s.best.key === o.key ? raw(' ✓') : ''}</td>`)}
          </tr>`)}</tbody></table></div></div>
      </section>

      <p class="hint mt">Assumptions (editable in Settings by an admin): diesel ${fmt.k(p.assumptions.dieselPriceK)}/L · battery ${fmt.k(p.assumptions.batteryCostKPerKwh)}/kWh · solar ${fmt.k(p.assumptions.solarCostKPerKw)}/kWp ·
        SLA credit ${p.assumptions.slaCreditMultiplier}× pro-rata fee per dark hour. Cost figures are planning placeholders, not quotes.</p>`.s;
  }

  const reload = debounce(() => load().catch(Toast.error.bind(Toast)), 250);
  ls.addEventListener('input', () => { st.hours = Number(ls.value); paintLabel(); reload(); });
  learned.addEventListener('change', () => { st.mode = learned.checked ? 'learned' : 'scenario'; paintLabel(); reload(); });
  budget.addEventListener('input', () => { const v = Number(budget.value); if (v >= 0) { st.budget = v; reload(); } });
  document.getElementById('csv').addEventListener('click', () => Api.download('/resilience/plan.csv?' + query(), 'toweriq-redundancy-plan.csv').catch(Toast.error.bind(Toast)));
  await load();
};
