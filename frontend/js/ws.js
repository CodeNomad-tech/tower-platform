// WebSocket client — connects to the backend's live event stream and
// fans events out to any registered listeners (dashboard, alerts, etc).
window.Live = {
  socket: null,
  listeners: new Set(),
  connected: false,

  connect() {
    if (this.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.socket.readyState)) return;
    const wsOrigin = (window.API_ORIGIN || 'http://localhost:3000').replace(/^http/, 'ws');
    this.socket = new WebSocket(`${wsOrigin}/ws`);

    this.socket.onopen = () => {
      this.connected = true;
      this._notifyConn(true);
    };
    this.socket.onclose = () => {
      this.connected = false;
      this.socket = null;
      this._notifyConn(false);
      setTimeout(() => this.connect(), 2000); // auto-reconnect
    };
    this.socket.onerror = () => this.socket.close();
    this.socket.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      for (const fn of this.listeners) fn(data);
    };
  },

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },

  _notifyConn(state) {
    const el = document.getElementById('conn-badge');
    if (!el) return;
    const dot = el.querySelector('.conn-dot');
    if (dot) dot.classList.toggle('live', state);
    const label = el.querySelector('[data-conn-label]');
    if (label) label.textContent = state ? 'Live' : 'Reconnecting...';
  },
};
