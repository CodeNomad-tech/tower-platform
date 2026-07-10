var Pages = window.Pages = window.Pages || {};

Pages.siteDetail = async function (siteId) {
  App.setTitle('Site Detail');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading…</div>';

  const [detail, powerHist, fuelHist, utilization, alerts] = await Promise.all([
    Api.get(`/sites/${siteId}`),
    Api.get(`/sites/${siteId}/power-history`),
    Api.get(`/sites/${siteId}/fuel-history`),
    Api.get(`/sites/${siteId}/power-utilization?period=weekly`),
    Api.get(`/alerts?siteId=${siteId}`),
  ]);

  const site = detail.site;
  App.setTitle(site.name);

  page.innerHTML = `
    <div class="section-head">
      <h2>${site.name} <span class="tag">${site.region || ''}</span></h2>
      <span class="badge ${site.status}"><span class="dot"></span>${site.status}</span>
    </div>

    <div class="grid grid-cols-4" style="margin-bottom:20px;">
      ${kpi('24h Uptime', '0.00%')}
      ${kpi('Fuel Level', '0.0%')}
      ${kpi('Cabinet Temp', '0.0°C')}
      ${kpi('Tenants', '0 / 0')}
    </div>

    <div class="grid grid-cols-2" style="margin-bottom:20px;">
      <div class="card">
        <div class="card-title">Active Power Source</div>
        <div id="power-sources" style="margin-top:10px;">${powerSourcesHtml(detail.latestPower)}</div>
      </div>
      <div class="card">
        <div class="card-title">Power Source Utilization (7d)</div>
        <canvas id="util-chart" style="width:100%; height:140px;"></canvas>
      </div>
    </div>

    <div class="grid grid-cols-2" style="margin-bottom:20px;">
      <div class="card">
        <div class="card-title">Fuel Level (24h)</div>
        <canvas id="fuel-chart" style="width:100%; height:160px;"></canvas>
      </div>
      <div class="card">
        <div class="card-title">Power Output — Grid (24h, W)</div>
        <canvas id="power-chart" style="width:100%; height:160px;"></canvas>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Recent Alerts</div>
      <div id="site-alerts">${alerts.alerts.length ? alerts.alerts.map(alertRowHtml).join('') : '<div class="empty-state">No alerts for this site</div>'}</div>
    </div>
  `;

  Charts.bar(document.getElementById('util-chart'), [], { color: '#3ea6ff' });

  Charts.line(
    document.getElementById('fuel-chart'),
    [],
    { color: '#34d399', min: 0, max: 100 }
  );

  Charts.line(
    document.getElementById('power-chart'),
    [],
    { color: '#fbbf24' }
  );

  document.querySelectorAll('[data-ack]').forEach(btn => btn.addEventListener('click', () => acknowledgeAlert(btn.dataset.ack, siteId)));
  document.querySelectorAll('[data-resolve]').forEach(btn => btn.addEventListener('click', () => resolveAlert(btn.dataset.resolve, siteId)));
};

function kpi(title, value) {
  return `<div class="card"><div class="card-title">${title}</div><div class="card-value">${value}</div></div>`;
}

function powerSourcesHtml(readings) {
  if (!readings.length) return '<div class="empty-state">No readings yet</div>';
  return readings.map(r => `
    <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border);">
      <span style="text-transform:capitalize;">${r.source}</span>
      <span>${r.active ? `<b style="color:var(--green);">ACTIVE</b> · 0W` : '<span style="color:var(--text-dim);">standby</span>'}</span>
    </div>`).join('');
}

function alertRowHtml(a) {
  return `
    <div class="alert-row">
      <div class="alert-icon ${a.severity}"></div>
      <div class="alert-body">
        <div class="alert-message">${a.message}</div>
        <div class="alert-meta">${a.type} · ${a.created_at} · <span class="tag">${a.status}</span></div>
      </div>
      <div class="alert-actions">
        ${a.status === 'new' ? `<button class="btn" data-ack="${a.id}">Acknowledge</button>` : ''}
        ${a.status !== 'resolved' ? `<button class="btn primary" data-resolve="${a.id}">Resolve</button>` : ''}
      </div>
    </div>`;
}

async function acknowledgeAlert(id, siteId) {
  await Api.post(`/alerts/${id}/acknowledge`);
  Pages.siteDetail(siteId);
}
async function resolveAlert(id, siteId) {
  await Api.post(`/alerts/${id}/resolve`);
  Pages.siteDetail(siteId);
}
