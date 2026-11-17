/* TowerIQ console core: utilities, API client, live feed, router, shell.
   No framework, no build step. All dynamic text is escaped via h``. */
'use strict';

// ---------------------------------------------------------------- utilities
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tagged template that escapes interpolations unless wrapped in raw().
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
function h(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

const fmt = {
  int: (n) => (n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-ZM')),
  k: (n) => (n == null || !isFinite(n) ? '—' : 'K' + Math.round(n).toLocaleString('en-ZM')),
  kShort: (n) => {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    return a >= 1e6 ? `K${(n / 1e6).toFixed(2)}m` : a >= 1e4 ? `K${(n / 1e3).toFixed(0)}k` : `K${Math.round(n).toLocaleString('en-ZM')}`;
  },
  pct: (n, d = 0) => (n == null || !isFinite(n) ? '—' : `${Number(n).toFixed(d)}%`),
  litres: (n) => (n == null || !isFinite(n) ? '—' : `${Math.round(n).toLocaleString('en-ZM')} L`),
  hours: (h) => {
    if (h == null || !isFinite(h)) return '—';
    if (h <= 0) return '0 h';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) { const H = Math.floor(h), M = Math.round((h - H) * 60); return M ? `${H} h ${M} m` : `${H} h`; }
    return `${(h / 24).toFixed(1)} days`;
  },
  // SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) or ISO → Date
  date: (ts) => (ts instanceof Date ? ts : new Date(String(ts).includes('T') ? ts : String(ts).replace(' ', 'T') + 'Z')),
  time: (ts) => fmt.date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  dateTime: (ts) => fmt.date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
  ago: (ts) => {
    const s = (Date.now() - fmt.date(ts).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  },
  until: (iso) => {
    const h = (fmt.date(iso).getTime() - Date.now()) / 3600000;
    if (h <= 0.05) return { text: 'now', over: true };
    return { text: 'in ' + fmt.hours(h), over: false };
  },
  label: (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
};

const SOURCE_LABEL = { grid: 'Grid', solar: 'Solar', battery: 'Battery', generator: 'Generator', none: 'DARK', dark: 'Dark' };
const RISK = {
  dark: { label: 'Dark now', cls: 'b-dark' }, critical: { label: 'Critical', cls: 'b-crit' },
  high: { label: 'High risk', cls: 'b-high' }, watch: { label: 'Watch', cls: 'b-watch' }, ok: { label: 'Secure', cls: 'b-ok' },
};
const srcTag = (s) => h`<span class="src src-${s || 'none'}"><i></i>${SOURCE_LABEL[s] || fmt.label(s) || '—'}</span>`;
const riskBadge = (r) => h`<span class="badge ${RISK[r]?.cls || 'b-neutral'}">${RISK[r]?.label || r}</span>`;
const sevBadge = (s) => h`<span class="badge b-${s}">${fmt.label(s)}</span>`;
function meter(pct) {
  if (pct == null) return h`<span class="dim small">n/a</span>`;
  const cls = pct < 20 ? 'low' : pct < 40 ? 'mid' : '';
  return h`<div class="meter ${cls}" role="img" aria-label="${fmt.pct(pct)}"><span style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></span></div>`;
}
const empty = (title, text) => h`<div class="empty"><strong>${title}</strong>${text || ''}</div>`;

// Minimal inline icons (stroke, currentColor).
const I = (d) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const ICONS = {
  logo: I('<path d="M12 3v18"/><path d="M8 21l4-12 4 12"/><path d="M5.5 6.5a9 9 0 0 1 13 0"/><path d="M8.3 9.3a5 5 0 0 1 7.4 0"/><circle cx="12" cy="11" r="1"/>'),
  command: I('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  sites: I('<path d="M12 3v18M8 21l4-12 4 12"/><path d="M5 8a10 10 0 0 1 14 0"/>'),
  alarm: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  planner: I('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>'),
  fuel: I('<path d="M3 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M3 21h12"/><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/><path d="M6 8h6"/>'),
  money: I('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  report: I('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  warn: I('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  check: I('<path d="M20 6L9 17l-5-5"/>'),
  download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>'),
  bolt: I('<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>'),
  shield: I('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
};

// ---------------------------------------------------------------- API client
const Api = {
  token: null,
  user: null,
  init() {
    try { this.token = sessionStorage.getItem('tiq_token'); this.user = JSON.parse(sessionStorage.getItem('tiq_user') || 'null'); } catch { /* storage unavailable */ }
  },
  setSession(token, user) {
    this.token = token; this.user = user;
    try {
      if (token) { sessionStorage.setItem('tiq_token', token); sessionStorage.setItem('tiq_user', JSON.stringify(user)); }
      else { sessionStorage.removeItem('tiq_token'); sessionStorage.removeItem('tiq_user'); }
    } catch { /* ignore */ }
  },
  can(role) { const r = { viewer: 1, operator: 2, admin: 3 }; return (r[this.user?.role] || 0) >= r[role]; },
  async request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('Cannot reach the TowerIQ server. Check the connection; data will refresh when it returns.');
    }
    if (res.status === 401 && path !== '/auth/login') {
      this.setSession(null, null);
      location.hash = '#/login';
      throw new Error('Your session has ended. Please sign in again.');
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  },
  get(p) { return this.request('GET', p); },
  post(p, b = {}) { return this.request('POST', p, b); },
  put(p, b = {}) { return this.request('PUT', p, b); },
  del(p) { return this.request('DELETE', p); },
  // Authenticated file download (CSV exports need the Bearer header, so plain links can't be used).
  async download(path, filename) {
    const res = await fetch('/api' + path, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};

// ---------------------------------------------------------------- live feed
const Live = {
  socket: null, listeners: new Set(), connected: false, retry: 0, feed: [],
  connect() {
    if (!Api.token || (this.socket && this.socket.readyState <= 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const s = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(Api.token)}`);
    this.socket = s;
    s.onopen = () => { this.connected = true; this.retry = 0; this.paint(); };
    s.onclose = () => {
      this.connected = false; this.socket = null; this.paint();
      if (Api.token) setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.retry++));
    };
    s.onerror = () => s.close();
    s.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      this.record(m);
      for (const fn of this.listeners) { try { fn(m); } catch (e) { console.error(e); } }
    };
  },
  disconnect() { const s = this.socket; this.socket = null; if (s) { s.onclose = null; s.close(); } this.connected = false; },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  // Keep a short human-readable feed of meaningful events (not every telemetry tick).
  record(m) {
    let text = null, tone = '';
    if (m.channel === 'alert' && m.alert) { text = `${m.siteId}: ${m.alert.message}`; tone = m.alert.severity; Toast.show(fmt.label(m.alert.type), `${m.siteId}: ${m.alert.message}`, m.alert.severity === 'critical' ? 'crit' : 'warn'); }
    else if (m.channel === 'switch') text = `${m.siteId}: supply ${SOURCE_LABEL[m.from] || m.from} → ${SOURCE_LABEL[m.to] || m.to}`, tone = m.to === 'none' ? 'critical' : '';
    else if (m.channel === 'status') text = `${m.siteId}: site ${m.status === 'down' ? 'LOST POWER' : 'power restored'}`, tone = m.status === 'down' ? 'critical' : 'ok';
    else if (m.channel === 'generator') text = `${m.siteId}: generator ${m.payload.event === 'start' ? 'started' : 'stopped'}`;
    if (text) { this.feed.unshift({ t: new Date(), text, tone }); this.feed.length = Math.min(this.feed.length, 60); }
  },
  paint() {
    const el = document.getElementById('live');
    if (el) el.innerHTML = h`<span class="live-dot ${this.connected ? 'on' : ''}"></span>${this.connected ? 'Live' : 'Reconnecting…'}`.s;
  },
};

// ---------------------------------------------------------------- toasts
const Toast = {
  show(title, text, tone = '') {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = `toast ${tone}`;
    t.innerHTML = h`<b>${title}</b>${text || ''}`.s;
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), 6000);
  },
  error(e) { this.show('Something went wrong', e?.message || String(e), 'crit'); },
};

// ---------------------------------------------------------------- router + shell
const Pages = {};
const App = {
  meta: null,
  cleanups: [],
  nav: [
    { path: '/', label: 'Command Center', icon: 'command' },
    { path: '/sites', label: 'Sites', icon: 'sites' },
    { path: '/alarms', label: 'Alarms', icon: 'alarm', badge: true },
    { sep: 'Intelligence' },
    { path: '/planner', label: 'Resilience Planner', icon: 'planner' },
    { path: '/fuel', label: 'Fuel Integrity', icon: 'fuel' },
    { path: '/commercial', label: 'Commercial', icon: 'money' },
    { path: '/reports', label: 'Reports', icon: 'report' },
    { sep: 'Admin' },
    { path: '/settings', label: 'Settings & Demo', icon: 'settings' },
  ],
  routes: [
    [/^\/$/, () => Pages.command()],
    [/^\/sites$/, () => Pages.sites()],
    [/^\/site\/([^/]+)$/, (m) => Pages.site(decodeURIComponent(m[1]))],
    [/^\/alarms$/, () => Pages.alarms()],
    [/^\/planner$/, () => Pages.planner()],
    [/^\/fuel$/, () => Pages.fuel()],
    [/^\/commercial$/, () => Pages.commercial()],
    [/^\/reports$/, () => Pages.reports()],
    [/^\/settings$/, () => Pages.settings()],
  ],

  async init() {
    Api.init();
    this.applyTheme();
    try { this.meta = await Api.get('/meta'); } catch { this.meta = {}; }
    window.addEventListener('hashchange', () => this.render());
    document.addEventListener('click', (e) => this.onClick(e));
    this.render();
  },

  // Register a teardown for the current page (timers, live listeners).
  onLeave(fn) { this.cleanups.push(fn); },

  rid: 0,
  // Pages capture App.rid when they start and drop stale async results if the user navigated away.
  stale(rid) { return rid !== this.rid; },

  async render() {
    this.rid++;
    this.cleanups.splice(0).forEach((f) => { try { f(); } catch { /* ignore */ } });
    const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
    if (!Api.token) { if (path !== '/login') { location.hash = '#/login'; return; } return Pages.login(); }
    if (path === '/login') { location.hash = '#/'; return; }
    const route = this.routes.find(([re]) => re.test(path));
    if (!document.getElementById('page')) this.mountShell();
    this.highlight(path);
    document.querySelector('.shell')?.classList.remove('nav-open');
    const page = document.getElementById('page');
    page.innerHTML = '<div class="skeleton"></div>';
    window.scrollTo(0, 0);
    Live.connect();
    if (!route) { this.setTitle('Not found'); page.innerHTML = empty('Page not found', 'Use the menu to navigate.').s; return; }
    try { await route[1](route[0].exec(path)); } catch (e) {
      page.innerHTML = h`<div class="notice warn"><b>Could not load this page.</b> ${e.message}</div>`.s;
    }
    this.refreshBadge();
  },

  mountShell() {
    const notice = this.meta?.dataNotice;
    document.getElementById('root').innerHTML = h`
      <div class="shell">
        <aside class="side" aria-label="Main navigation">
          <a class="brand" href="#/">${ICONS.logo}<span>TowerIQ<small>Tower resilience intelligence</small></span></a>
          <nav class="nav">
            ${this.nav.map((n) => n.sep ? h`<div class="nav-sep">${n.sep}</div>`
              : (n.path === '/settings' && !Api.can('admin') ? '' : h`<a href="#${n.path}" data-path="${n.path}">${ICONS[n.icon]}<span>${n.label}</span>${n.badge ? raw('<span class="count" id="alarm-count" hidden></span>') : ''}</a>`))}
          </nav>
          <div class="side-foot">
            <div class="who">${Api.user?.email || ''}</div>
            <div>${fmt.label(Api.user?.role)} · <button type="button" data-action="logout">Sign out</button></div>
          </div>
        </aside>
        <div class="main">
          <header class="top">
            <button class="icon-btn menu-btn" type="button" data-action="menu" aria-label="Open menu">${ICONS.menu}</button>
            <h1 id="title">TowerIQ</h1>
            <span class="spacer"></span>
            ${notice ? h`<span class="pill sim hide-sm" title="${notice}">Simulated demo data</span>` : ''}
            <span class="pill" id="live"></span>
            <button class="icon-btn" type="button" data-action="theme" aria-label="Toggle light/dark theme">${document.documentElement.dataset.theme === 'light' ? ICONS.moon : ICONS.sun}</button>
          </header>
          <main class="content" id="page" tabindex="-1"></main>
        </div>
      </div>`.s;
    Live.paint();
    Live.on((m) => { if (m.channel === 'alert' || m.channel === 'status') this.refreshBadge(); });
  },

  async refreshBadge() {
    try {
      const m = await Api.get('/alerts/metrics/mttx');
      const n = (m.open.critical || 0);
      const el = document.getElementById('alarm-count');
      if (el) { el.hidden = !n; el.textContent = n; }
    } catch { /* ignore */ }
  },

  highlight(path) {
    document.querySelectorAll('.nav a').forEach((a) => {
      const p = a.dataset.path;
      const on = p === path || (p === '/sites' && path.startsWith('/site/'));
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  },

  setTitle(t) { const el = document.getElementById('title'); if (el) el.textContent = t; document.title = `${t} · TowerIQ`; },

  onClick(e) {
    const a = e.target.closest('[data-action]');
    if (a) {
      const act = a.dataset.action;
      if (act === 'logout') { e.preventDefault(); this.logout(); }
      else if (act === 'menu') document.querySelector('.shell')?.classList.toggle('nav-open');
      else if (act === 'theme') this.toggleTheme();
      return;
    }
    const row = e.target.closest('[data-href]');
    if (row && !e.target.closest('button, a, input, select, form')) location.hash = row.dataset.href;
  },

  async logout() {
    try { await Api.post('/auth/logout'); } catch { /* ignore */ }
    Api.setSession(null, null);
    Live.disconnect();
    document.getElementById('root').innerHTML = '';
    location.hash = '#/login';
  },

  applyTheme() {
    let t = null;
    try { t = localStorage.getItem('tiq_theme'); } catch { /* ignore */ }
    if (t) document.documentElement.dataset.theme = t;
  },
  toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('tiq_theme', next); } catch { /* ignore */ }
    const b = document.querySelector('[data-action="theme"]');
    if (b) b.innerHTML = (next === 'light' ? ICONS.moon : ICONS.sun).s;
    window.dispatchEvent(new Event('themechange'));
  },
};

// Debounce helper for live refreshes.
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
// Subscribe to live channels for the current page only; auto-unsubscribed on navigation.
function liveRefresh(channels, fn, ms = 1500) {
  const d = debounce(fn, ms);
  App.onLeave(Live.on((m) => { if (channels.includes(m.channel)) d(m); }));
}

document.addEventListener('DOMContentLoaded', () => App.init());
