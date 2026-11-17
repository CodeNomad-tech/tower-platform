/* Sign-in. The left panel states the product's purpose so a first-time viewer understands it in seconds. */
'use strict';

Pages.login = function () {
  document.title = 'Sign in · TowerIQ';
  const demo = App.meta?.demoMode;
  document.getElementById('root').innerHTML = h`
    <div class="login">
      <section class="login-pitch">
        <div class="brand" style="padding:0">${ICONS.logo}<span>TowerIQ<small>Tower resilience intelligence</small></span></div>
        <h1>Know which towers will go dark before they do.</h1>
        <p>Load-shedding decides whether a tower stays on air. TowerIQ turns each site's telemetry into a forecast of when it will run out of power, what to do first, and which upgrades remove the most downtime per Kwacha.</p>
        <div class="login-points">
          <div>${ICONS.bolt}<span><b>Blackout runway</b>Probability and time to blackout for every tower, from its own fuel, battery, solar and learned grid pattern.</span></div>
          <div>${ICONS.check}<span><b>Do-this-next queue</b>Refuels, responses and pre-positioning ranked by deadline and valued in Kwacha.</span></div>
          <div>${ICONS.planner}<span><b>Redundancy planner</b>A costed, ranked battery/solar upgrade plan for any load-shedding scenario.</span></div>
          <div>${ICONS.shield}<span><b>Fuel integrity</b>Every litre reconciled; theft, siphoning and failing generators separated.</span></div>
        </div>
      </section>
      <section class="login-form">
        <form class="login-card" id="login" novalidate>
          <h2>Sign in</h2>
          ${App.meta?.dataNotice ? h`<div class="notice warn small">${App.meta.dataNotice}</div>` : ''}
          <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="username" required value="${demo ? App.meta.demoLogin.email : ''}"></div>
          <div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required value="${demo ? 'ChangeMe123!' : ''}"></div>
          <button class="btn primary" type="submit" style="padding:10px">Sign in</button>
          <div class="error-text" id="err" role="alert"></div>
          ${demo ? h`<div class="small muted">Demo accounts (same password) show what each role can do:</div>
            <div class="demo-accounts">
              <button type="button" data-u="admin@toweriq.demo"><b>Admin</b>: everything, incl. assumptions and demo controls</button>
              <button type="button" data-u="operator@toweriq.demo"><b>Operator</b>: handle alarms, log deliveries</button>
              <button type="button" data-u="viewer@toweriq.demo"><b>Viewer</b>: read-only (e.g. a tenant or executive)</button>
            </div>` : ''}
        </form>
      </section>
    </div>`.s;

  const form = document.getElementById('login');
  form.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => { form.email.value = b.dataset.u; form.password.focus(); }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    if (!form.email.value || !form.password.value) { err.textContent = 'Enter your email and password.'; return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const r = await Api.post('/auth/login', { email: form.email.value, password: form.password.value });
      Api.setSession(r.token, r.user);
      document.getElementById('root').innerHTML = '';
      location.hash = '#/';
      App.render();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Sign in'; }
  });
};
