var Pages = window.Pages = window.Pages || {};

Pages.alerts = async function () {
  App.setTitle('Alerts');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading…</div>';

  const [all, mttx] = await Promise.all([Api.get('/alerts'), Api.get('/alerts/metrics/mttx')]);

  page.innerHTML = `
    <div class="grid grid-cols-3" style="margin-bottom:20px;">
      <div class="card"><div class="card-title">Open Alerts</div><div class="card-value">${all.alerts.filter(a => a.status !== 'resolved').length}</div></div>
      <div class="card"><div class="card-title">Mean Time to Acknowledge</div><div class="card-value">${mttx.meanTimeToAcknowledgeMin ? mttx.meanTimeToAcknowledgeMin + 'm' : '—'}</div></div>
      <div class="card"><div class="card-title">Mean Time to Resolve</div><div class="card-value">${mttx.meanTimeToResolveMin ? mttx.meanTimeToResolveMin + 'm' : '—'}</div></div>
    </div>

    <div class="section-head">
      <h2>Alert Feed</h2>
      <div>
        <select id="status-filter" class="btn">
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
    </div>
    <div class="card"><div id="alert-list">${renderAlertList(all.alerts)}</div></div>
  `;

  document.getElementById('status-filter').addEventListener('change', async (e) => {
    const q = e.target.value ? `?status=${e.target.value}` : '';
    const data = await Api.get(`/alerts${q}`);
    document.getElementById('alert-list').innerHTML = renderAlertList(data.alerts);
    bindActions();
  });

  bindActions();

  const unsubscribe = Live.on((msg) => {
    if (msg.channel === 'alert') Pages.alerts(); // simplest correct approach: re-fetch on new alert
  });
  const cleanup = () => { unsubscribe(); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup, { once: true });
};

function renderAlertList(alerts) {
  if (!alerts.length) return '<div class="empty-state">No alerts</div>';
  return alerts.map(a => `
    <div class="alert-row">
      <div class="alert-icon ${a.severity}"></div>
      <div class="alert-body">
        <div class="alert-message">${a.message}</div>
        <div class="alert-meta">${a.site_id} · ${a.type} · ${a.created_at} · <span class="tag">${a.status}</span></div>
      </div>
      <div class="alert-actions">
        ${a.status === 'new' ? `<button class="btn" data-ack="${a.id}">Acknowledge</button>` : ''}
        ${a.status !== 'resolved' ? `<button class="btn primary" data-resolve="${a.id}">Resolve</button>` : ''}
      </div>
    </div>`).join('');
}

function bindActions() {
  document.querySelectorAll('[data-ack]').forEach(btn => btn.onclick = async () => {
    await Api.post(`/alerts/${btn.dataset.ack}/acknowledge`);
    Pages.alerts();
  });
  document.querySelectorAll('[data-resolve]').forEach(btn => btn.onclick = async () => {
    await Api.post(`/alerts/${btn.dataset.resolve}/resolve`);
    Pages.alerts();
  });
}
