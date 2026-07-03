var Pages = window.Pages = window.Pages || {};

Pages.dashboard = async function () {
  App.setTitle('Executive Dashboard');
  const page = document.getElementById('page');
  page.innerHTML = '<div class="empty-state">Loading…</div>';

  const [sitesRes, exec] = await Promise.all([
    Api.get('/sites'),
    Api.get('/reports/executive-summary'),
  ]);
  const sites = sitesRes.sites;

  page.innerHTML = `
    <div class="grid grid-cols-4" style="margin-bottom:24px;">
      ${kpiCard('Sites Online', `${exec.onlineSites}/${exec.totalSites}`, exec.offlineSites ? `${exec.offlineSites} offline` : 'All operational')}
      ${kpiCard('Avg 30-day Uptime', `${exec.avgUptime30d.toFixed(2)}%`, 'Across all sites')}
      ${kpiCard('Open Alerts', exec.openAlerts, `${exec.criticalAlerts} critical`)}
      ${kpiCard('Monthly Revenue', `K${exec.totalRevenue.toLocaleString()}`, `${exec.totalTenants} active tenants`)}
    </div>

    <div class="section-head"><h2>Sites</h2></div>
    <div class="grid grid-cols-3" id="site-grid"></div>
  `;

  renderSiteGrid(sites);

  const unsubscribe = Live.on((msg) => {
    if (['heartbeat', 'power', 'fuel', 'env', 'alert'].includes(msg.channel)) {
      refreshSiteCard(msg.siteId);
    }
  });
  // Clean up the listener when navigating away
  const cleanup = () => { unsubscribe(); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup, { once: true });
};

function kpiCard(title, value, sub) {
  return `<div class="card"><div class="card-title">${title}</div><div class="card-value">${value}</div><div class="card-sub">${sub}</div></div>`;
}

function renderSiteGrid(sites) {
  const grid = document.getElementById('site-grid');
  if (!sites.length) { grid.innerHTML = '<div class="empty-state">No sites configured yet</div>'; return; }
  grid.innerHTML = sites.map(siteCardHtml).join('');
}

function siteCardHtml(site) {
  return `
    <div class="card site-card" id="site-card-${site.id}" onclick="window.location.hash='#/site/${site.id}'">
      <div class="site-card-head">
        <div>
          <div class="site-name">${site.name}</div>
          <div class="site-region">${site.region || ''}</div>
        </div>
        <span class="badge ${site.status}"><span class="dot"></span>${site.status}</span>
      </div>
      <div class="site-metrics">
        <div>Capacity <b>${site.capacity}</b></div>
        <div>Last seen <b>${site.last_heartbeat ? timeAgo(site.last_heartbeat) : 'never'}</b></div>
      </div>
    </div>`;
}

async function refreshSiteCard(siteId) {
  // Lightweight refresh: re-fetch just this site's summary and patch its card in place.
  try {
    const { site } = await Api.get(`/sites/${siteId}`);
    const el = document.getElementById(`site-card-${siteId}`);
    if (el) el.outerHTML = siteCardHtml(site);
  } catch { /* site card may not be on screen anymore */ }
}

function timeAgo(ts) {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}
