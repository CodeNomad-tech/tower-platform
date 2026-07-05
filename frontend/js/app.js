// App shell: sidebar, router, page mounting.
const App = {
  routes: {
    '/': () => Api.token ? Pages.dashboard() : Pages.landing(),
    '/landing': () => Pages.landing(),
    '/login': () => Pages.login(),
    '/site/:id': (params) => Pages.siteDetail(params.id),
    '/alerts': () => Pages.alerts(),
    '/tenancy': () => Pages.tenancy(),
    '/ai-filter': () => Pages.aiFilter(),
    '/reports': () => Pages.reports(),
  },

  navItems: [
    { path: '/', label: 'Dashboard', icon: '&#9679;' },
    { path: '/alerts', label: 'Alerts', icon: '&#9888;' },
    { path: '/tenancy', label: 'Tenancy', icon: '&#127959;' },
    { path: '/ai-filter', label: 'AI FILTER', icon: '&#129302;' },
    { path: '/reports', label: 'Reports', icon: '&#128202;' },
  ],

  init() {
    if (!window.location.hash) window.location.hash = '#/landing';
    window.addEventListener('hashchange', () => this.render());
    this.render();
  },

  matchRoute(hash) {
    const path = hash.replace(/^#/, '') || '/';
    for (const pattern of Object.keys(this.routes)) {
      const paramNames = [];
      const regexStr = '^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; }) + '$';
      const match = new RegExp(regexStr).exec(path);
      if (match) {
        const params = {};
        paramNames.forEach((n, i) => { params[n] = match[i + 1]; });
        return { handler: this.routes[pattern], params };
      }
    }
    return null;
  },

  async render() {
    const root = document.getElementById('root');
    const found = this.matchRoute(window.location.hash);

    // Unauthenticated users: show landing page first
    if (!Api.token && !['#/login', '#/landing', '#'].includes(window.location.hash)) {
      window.location.hash = '#/landing';
      return;
    }

    if (window.location.hash === '#/login' || window.location.hash === '#/landing' || !found) {
      root.innerHTML = '<div id="page"></div>';
      if (window.location.hash === '#/login' || window.location.hash === '#/landing') {
        if (window.location.hash === '#/login') Pages.login();
        else Pages.landing();
        return;
      }
    }

    if (!found) {
      document.getElementById('page').innerHTML = '<div class="empty-state">Page not found</div>';
      return;
    }

    root.innerHTML = this.shellHtml();
    this.highlightNav();
    if (!Live.socket) Live.connect();
    else Live._notifyConn(Live.connected);
    await found.handler(found.params);
  },

  shellHtml() {
    return `
      <div class="app-shell">
        <div class="sidebar">
          <div class="sidebar-brand"><span class="dot"></span> Tower Platform</div>
          <nav>
            ${this.navItems.map(n => `
              <div class="nav-item" data-path="${n.path}" onclick="window.location.hash='#${n.path}'">
                ${n.label}
              </div>`).join('')}
          </nav>
          <div class="sidebar-footer">
            Smart Tower Monitoring &amp; Infrastructure Intelligence
            <div style="margin-top:8px;"><a href="#" onclick="App.logout(); return false;" style="color:var(--red);">Log out</a></div>
          </div>
        </div>
        <div class="main">
          <div class="topbar">
            <h1 id="page-title">Dashboard</h1>
            <div id="conn-badge" class="conn-badge"><span class="conn-dot"></span><span data-conn-label>Connecting...</span></div>
          </div>
          <div class="content" id="page"></div>
        </div>
      </div>`;
  },

  highlightNav() {
    const path = window.location.hash.replace(/^#/, '') || '/';
    document.querySelectorAll('.nav-item').forEach(el => {
      const isSiteDetail = path.startsWith('/site/') && el.dataset.path === '/';
      el.classList.toggle('active', el.dataset.path === path || isSiteDetail);
    });
  },

  setTitle(t) {
    const el = document.getElementById('page-title');
    if (el) el.textContent = t;
  },

  logout() {
    Api.setToken(null);
    window.location.hash = '#/login';
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
