// API client — thin fetch wrapper with auth token and JSON handling.
const API_ORIGIN = window.API_ORIGIN || 'http://localhost:3000';
const API_BASE = `${API_ORIGIN}/api`;

const Api = {
  token: localStorage.getItem('tp_token') || null,

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('tp_token', token);
    else localStorage.removeItem('tp_token');
  },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(API_BASE + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      this.setToken(null);
      window.location.hash = '#/login';
    }
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  delete(path) { return this.request('DELETE', path); },
};
