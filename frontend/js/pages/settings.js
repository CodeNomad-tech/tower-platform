/* Admin: business assumptions, demo scenario controls, camera-node pairing, users, audit log. */
'use strict';

Pages.settings = async function () {
  App.setTitle('Settings & Demo');
  const page = document.getElementById('page');
  if (!Api.can('admin')) { page.innerHTML = empty('Admins only', 'Ask an administrator to change settings.').s; return; }
  const rid = App.rid;
  const [{ settings }, { sites }, { users }, demo, audit] = await Promise.all([
    Api.get('/settings'), Api.get('/sites'), Api.get('/auth/users'), Api.get('/demo/status'), Api.get('/settings/audit'),
  ]);
  if (App.stale(rid)) return;

  page.innerHTML = h`
    ${demo.enabled ? h`
    <section class="card" style="border-color:color-mix(in srgb,var(--watch) 45%,transparent)">
      <div class="card-h"><h2>Demo scenario controls</h2><span class="sub">Physically change a SIMULATED site; the platform reacts through its normal telemetry pipeline</span></div>
      <div class="card-b">
        <form id="scn" class="form-row">
          <div class="field"><label for="s-site">Site</label><select class="input" id="s-site" name="siteId">${sites.filter((s) => s.simulated).map((s) => h`<option value="${s.id}">${s.name} (${s.id})</option>`)}</select></div>
          <div class="field"><label for="s-act">Event</label><select class="input" id="s-act" name="action">
            <option value="outage">Grid feeder outage (load-shedding block)</option>
            <option value="restore">Restore grid now</option>
            <option value="siphon">Fuel siphoned from tank</option>
            <option value="intrusion">Intruder seen on camera</option>
            <option value="smoke">Smoke in equipment shelter</option></select></div>
          <div class="field" id="s-amt-f"><label for="s-amt" id="s-amt-l">Hours</label><input class="input" id="s-amt" name="amount" type="number" min="0.25" step="0.25" value="8"></div>
          <button class="btn primary" type="submit">Trigger</button>
        </form>
        <p class="hint">Suggested demo: trigger a 150 L siphon at Livingstone Relay → watch the theft alarm and the Command Center action appear within ~10 s.</p>
      </div>
    </section>` : ''}

    <section class="card mt">
      <div class="card-h"><h2>Business assumptions</h2><span class="sub">Every Kwacha figure in TowerIQ depends on these. Replace placeholders with contract and procurement values.</span></div>
      <div class="card-b">
        <form id="assump" class="stack">
          ${settings.map((s) => h`<div class="form-row" style="grid-template-columns:minmax(0,1fr) 180px">
            <div><b>${s.label}</b> <span class="dim small">(${s.unit})</span><div class="hint">${s.source}</div></div>
            <input class="input" name="${s.key}" type="number" step="any" min="${s.min}" max="${s.max}" value="${s.value}" aria-label="${s.label}">
          </div>`)}
          <div><button class="btn primary" type="submit">Save assumptions</button></div>
        </form>
      </div>
    </section>

    <div class="grid g2 mt">
      <section class="card">
        <div class="card-h"><h2>Pair a phone camera node</h2></div>
        <div class="card-b">
          <p class="small muted">Any phone with a browser becomes a CCTV node: motion is detected on the phone and only the <i>event</i> is sent, never video. Each device gets its own key.</p>
          <form id="pair" class="row"><input class="input" name="label" placeholder="Label, e.g. Kitwe gate camera" maxlength="60" style="max-width:260px"><button class="btn" type="submit">Create pairing link</button></form>
          <div id="pair-out" class="mt"></div>
          <p class="hint">Camera access needs HTTPS (or localhost). On a venue network, use a tunnel (see docs/DEPLOYMENT.md).</p>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h2>Users</h2></div>
        <div class="card-b">
          <table class="mb"><tbody>${users.map((u) => h`<tr><td>${u.email}</td><td><span class="badge b-neutral plain">${u.role}</span></td></tr>`)}</tbody></table>
          <form id="user" class="form-row">
            <div class="field"><label for="u-e">Email</label><input class="input" id="u-e" name="email" type="email" required></div>
            <div class="field"><label for="u-p">Temporary password</label><input class="input" id="u-p" name="password" type="password" minlength="10" required></div>
            <div class="field"><label for="u-r">Role</label><select class="input" id="u-r" name="role"><option value="viewer">Viewer (read-only)</option><option value="operator" selected>Operator (alarms, deliveries)</option><option value="admin">Admin</option></select></div>
            <button class="btn" type="submit">Add user</button>
          </form>
        </div>
      </section>
    </div>

    <section class="card mt"><div class="card-h"><h2>Audit log</h2><span class="sub">Who changed what</span></div>
      <div class="card-b flush"><div class="table-wrap" style="max-height:320px;overflow:auto"><table><tbody>${audit.entries.slice(0, 80).map((e) => h`<tr><td class="small nowrap">${fmt.dateTime(e.ts)}</td><td class="small">${e.email || 'system'}</td><td><span class="mono">${e.action}</span></td><td class="small dim" style="max-width:420px;overflow:hidden;text-overflow:ellipsis">${e.detail || ''}</td></tr>`)}</tbody></table></div></div></section>`.s;

  const scn = document.getElementById('scn');
  if (scn) {
    const act = document.getElementById('s-act'), amtF = document.getElementById('s-amt-f'), amtL = document.getElementById('s-amt-l'), amt = document.getElementById('s-amt');
    const sync = () => {
      const a = act.value;
      amtF.hidden = !['outage', 'siphon'].includes(a);
      amtL.textContent = a === 'siphon' ? 'Litres' : 'Hours';
      if (a === 'siphon' && Number(amt.value) < 20) amt.value = 150;
      if (a === 'outage' && Number(amt.value) > 72) amt.value = 8;
    };
    act.addEventListener('change', sync); sync();
    scn.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { siteId: scn.siteId.value, action: act.value };
      if (act.value === 'outage') body.hours = Number(amt.value);
      if (act.value === 'siphon') body.litres = Number(amt.value);
      try { await Api.post('/demo/scenario', body); Toast.show('Scenario triggered', `${fmt.label(body.action)} at ${body.siteId}. Watch the Command Center.`, 'ok'); }
      catch (err) { Toast.error(err); }
    });
  }
  document.getElementById('assump').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries([...new FormData(e.target).entries()].map(([k, v]) => [k, Number(v)]));
    try { await Api.put('/settings', body); Toast.show('Assumptions saved', 'Forecasts and plans now use the new values.', 'ok'); }
    catch (err) { Toast.error(err); }
  });
  document.getElementById('pair').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await Api.post('/settings/device-keys', { label: e.target.label.value || 'Camera node' });
      const url = `${location.origin}/camera-node/?key=${encodeURIComponent(r.key)}`;
      document.getElementById('pair-out').innerHTML = h`<div class="notice"><b>Open this on the phone</b> (shown once):<div class="mono" style="word-break:break-all;margin-top:6px">${url}</div></div>`.s;
    } catch (err) { Toast.error(err); }
  });
  document.getElementById('user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { await Api.post('/auth/users', Object.fromEntries(fd.entries())); Toast.show('User added', fd.get('email'), 'ok'); Pages.settings(); }
    catch (err) { Toast.error(err); }
  });
};
