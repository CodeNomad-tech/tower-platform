'use strict';
/**
 * Minimal Express-like router on node:http (zero dependencies).
 * Path params (:id), JSON bodies (size-limited, malformed JSON → 400),
 * middleware chains, res.json()/res.status(), uniform JSON errors.
 */

const config = require('../config');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function pathToRegex(path) {
  const paramNames = [];
  const pattern = path.replace(/\/:[a-zA-Z0-9_]+/g, (m) => { paramNames.push(m.slice(2)); return '/([^/]+)'; });
  return { regex: new RegExp(`^${pattern}/?$`), paramNames };
}

class Router {
  constructor() { this.routes = []; this.mounts = []; }
  _add(method, path, ...handlers) { this.routes.push({ method, ...pathToRegex(path), handlers }); }
  get(p, ...h) { this._add('GET', p, ...h); }
  post(p, ...h) { this._add('POST', p, ...h); }
  put(p, ...h) { this._add('PUT', p, ...h); }
  patch(p, ...h) { this._add('PATCH', p, ...h); }
  delete(p, ...h) { this._add('DELETE', p, ...h); }
  use(prefix, sub) { this.mounts.push({ prefix, sub }); }

  _find(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (m) return { route, match: m };
    }
    for (const { prefix, sub } of this.mounts) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        const found = sub._find(method, pathname.slice(prefix.length) || '/');
        if (found) return found;
      }
    }
    return null;
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, 'http://local');
      req.query = Object.fromEntries(url.searchParams);
      const found = this._find(req.method, url.pathname);
      if (!found) throw new HttpError(404, 'Not found');
      const { route, match } = found;
      req.params = {};
      route.paramNames.forEach((n, i) => { req.params[n] = decodeURIComponent(match[i + 1]); });
      req.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await parseJsonBody(req) : {};

      for (const handler of route.handlers) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced || res.writableEnded) break;
      }
    } catch (e) {
      sendError(res, e);
    }
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > config.MAX_BODY_BYTES) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return reject(new HttpError(400, 'Body must be a JSON object'));
        resolve(v);
      } catch { reject(new HttpError(400, 'Malformed JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[http] error:', err);
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: status >= 500 ? 'Internal server error' : err.message }));
  }
}

function attachHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  res.send = (body) => res.end(body);
}

// Request validation helpers ---------------------------------------------
function str(v, name, { max = 200, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be text`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${name} is required`);
  if (t.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return t;
}
function num(v, name, { min = -Infinity, max = Infinity, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be a number between ${min} and ${max}`);
  return n;
}

module.exports = { Router, HttpError, attachHelpers, sendError, str, num };
