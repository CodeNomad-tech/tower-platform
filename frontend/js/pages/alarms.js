/* Alarm management: triage, acknowledge, resolve with a note, MTTA/MTTR. */
'use strict';

Pages.alarms = async function () {
  App.setTitle('Alarms');
  const page = document.getElementById('page');
  const rid = App.rid;
  const state = { status: 'open', severity: '', siteId: '' };

  page.innerHTML = h`
    <div class="grid g4" id="mttx"><div class="skeleton" style="height:90px"></div></div>
    <div class="card mt">
      <div class="card-h">
        <h2>Alarm queue</h2>
        <div class="row">
          <select class="input" id="f-status" aria-label="Status" style="width:auto">
            <option value="open">Open (new + acknowledged)</option><option value="new">New</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="">All</option>
          </select>
          <select class="input" id="f-sev" aria-label="Severity" style="width:auto"><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option></select>
          <select class="input" id="f-site" aria-label="Site" style="width:auto"><option value="">All sites</option></select>
          <button class="btn sm" id="exp">${ICONS.download} CSV</button>
        </div>
      </div>
      <div class="card-b flush"><div class="table-wrap" id="list"></div></div>
    </div>`.s;

  const { sites } = await Api.get('/sites');
  const sel = document.getElementById('f-site');
  sites.forEach((s) => sel.insertAdjacentHTML('beforeend', h`<option value="${s.id}">${s.name}</option>`.s));

  async function loadMetrics() {
    const m = await Api.get('/alerts/metrics/mttx');
    if (App.stale(rid)) return;
    document.getElementById('mttx').innerHTML = h`
      <div class="card kpi ${m.open.critical ? 'crit' : 'ok'}"><div class="kpi-label">Open critical</div><div class="kpi-value">${m.open.critical || 0}</div><div class="kpi-sub">${m.open.warning || 0} warnings open</div></div>
      <div class="card kpi"><div class="kpi-label">Mean time to acknowledge</div><div class="kpi-value">${m.meanTimeToAcknowledgeMin != null ? fmt.hours(m.meanTimeToAcknowledgeMin / 60) : '—'}</div><div class="kpi-sub">${m.sampleSize.acknowledged} alarms, last ${m.days} days</div></div>
      <div class="card kpi"><div class="kpi-label">Mean time to resolve</div><div class="kpi-value">${m.meanTimeToResolveMin != null ? fmt.hours(m.meanTimeToResolveMin / 60) : '—'}</div><div class="kpi-sub">${m.sampleSize.resolved} alarms, incl. auto-resolved outages</div></div>
      <div class="card kpi"><div class="kpi-label">Alarms raised</div><div class="kpi-value">${m.sampleSize.total}</div><div class="kpi-sub">last ${m.days} days</div></div>`.s;
  }

  async function loadList() {
    const q = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
    const { alerts } = await Api.get('/alerts' + (q ? '?' + q : ''));
    if (App.stale(rid)) return;
    const canAct = Api.can('operator');
    document.getElementById('list').innerHTML = (alerts.length ? h`<table>
      <thead><tr><th>Severity</th><th>Alarm</th><th>Site</th><th>Raised</th><th>Status</th><th></th></tr></thead>
      <tbody>${alerts.map((a) => h`<tr>
        <td>${sevBadge(a.severity)}</td>
        <td><b>${fmt.label(a.type)}</b><div class="small muted">${a.message}</div>${a.resolution_note ? h`<div class="small dim">Note: ${a.resolution_note}</div>` : ''}</td>
        <td><a href="#/site/${encodeURIComponent(a.site_id)}">${a.site_name}</a></td>
        <td class="nowrap small">${fmt.dateTime(a.created_at)}<div class="dim">${fmt.ago(a.created_at)}</div></td>
        <td class="small">${fmt.label(a.status)}${a.acknowledged_by_email ? h`<div class="dim">ack ${a.acknowledged_by_email}</div>` : ''}${a.status === 'resolved' && !a.resolved_by_email ? h`<div class="dim">auto</div>` : ''}</td>
        <td class="nowrap">${canAct && a.status === 'new' ? h`<button class="btn sm" data-ack="${a.id}">Acknowledge</button> ` : ''}${canAct && a.status !== 'resolved' ? h`<button class="btn sm primary" data-resolve="${a.id}">Resolve</button>` : ''}</td>
      </tr>`)}</tbody></table>` : empty('No alarms match these filters', state.status === 'open' ? 'Nothing is open right now.' : '')).s;
  }

  page.addEventListener('click', async (e) => {
    const ack = e.target.closest('[data-ack]'), res = e.target.closest('[data-resolve]'), save = e.target.closest('[data-save]');
    try {
      if (ack) { ack.disabled = true; await Api.post(`/alerts/${ack.dataset.ack}/acknowledge`); await Promise.all([loadList(), loadMetrics()]); }
      if (res) {
        const row = res.closest('tr');
        if (!row.nextElementSibling?.classList.contains('resolve-row')) {
          row.insertAdjacentHTML('afterend', h`<tr class="resolve-row"><td></td><td colspan="5"><div class="row"><input class="input" style="max-width:420px" placeholder="What was done? (optional)" maxlength="500" aria-label="Resolution note"><button class="btn sm primary" data-save="${res.dataset.resolve}">Confirm resolve</button></div></td></tr>`.s);
          row.nextElementSibling.querySelector('input').focus();
        }
      }
      if (save) {
        save.disabled = true;
        await Api.post(`/alerts/${save.dataset.save}/resolve`, { note: save.previousElementSibling.value || null });
        Toast.show('Alarm resolved', '', 'ok');
        await Promise.all([loadList(), loadMetrics()]);
      }
    } catch (err) { Toast.error(err); }
  });
  document.getElementById('f-status').addEventListener('change', (e) => { state.status = e.target.value; loadList(); });
  document.getElementById('f-sev').addEventListener('change', (e) => { state.severity = e.target.value; loadList(); });
  sel.addEventListener('change', (e) => { state.siteId = e.target.value; loadList(); });
  document.getElementById('exp').addEventListener('click', () => Api.download('/reports/export/alerts.csv', 'toweriq-alarms.csv').catch(Toast.error.bind(Toast)));

  await Promise.all([loadMetrics(), loadList()]);
  liveRefresh(['alert', 'status'], () => { loadList(); loadMetrics(); }, 1500);
};
