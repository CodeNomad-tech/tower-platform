// WebSocket client — connects to the backend's live event stream and
// fans events out to any registered listeners (dashboard, alerts, etc).
const Live = {
  socket: null,
  listeners: new Set(),
  connected: false,

  connect() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${proto}://${window.location.host}/ws`);

    this.socket.onopen = () => {
      this.connected = true;
      this._notifyConn(true);
    };
    this.socket.onclose = () => {
      this.connected = false;
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
    el.classList.toggle('live', state);
    el.querySelector('span').textContent = state ? 'Live' : 'Reconnecting…';
  },
};
