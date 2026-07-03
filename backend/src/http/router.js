'use strict';
/**
 * Minimal Express-like router built on node:http. Zero dependencies.
 * Supports: path params (:id), JSON body parsing, middleware chains,
 * res.json()/res.status() helpers, and a catch-all 404/error handler.
 *
 * Production upgrade path: this mirrors Express's API shape closely
 * enough that migrating to Express (if the team wants its wider
 * middleware ecosystem) is a mechanical, low-risk change.
 */

function pathToRegex(path) {
  const paramNames = [];
  const pattern = path
    .replace(/\/:[a-zA-Z0-9_]+/g, (match) => {
      paramNames.push(match.slice(2));
      return '/([^/]+)';
    });
  return { regex: new RegExp(`^${pattern}$`), paramNames };
}

class Router {
  constructor() {
    this.routes = []; // { method, regex, paramNames, handlers }
    this.mounts = [];  // { prefix, subRouter }
  }

  _add(method, path, ...handlers) {
    const { regex, paramNames } = pathToRegex(path);
    this.routes.push({ method, regex, paramNames, handlers });
  }

  get(path, ...h) { this._add('GET', path, ...h); }
  post(path, ...h) { this._add('POST', path, ...h); }
  patch(path, ...h) { this._add('PATCH', path, ...h); }
  put(path, ...h) { this._add('PUT', path, ...h); }
  delete(path, ...h) { this._add('DELETE', path, ...h); }

  use(path, subRouter) {
    if (typeof path !== 'string') { subRouter = path; path = ''; }
    this.mounts.push({ prefix: path, subRouter });
  }

  // Finds a matching route (own or in a mounted sub-router) for method+pathname.
  _findRoute(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.regex.exec(pathname);
      if (match) return { route, match };
    }
    for (const { prefix, subRouter } of this.mounts) {
      if (pathname === prefix || pathname.startsWith(prefix + '/') || prefix === '') {
        const remainder = pathname.slice(prefix.length) || '/';
        const found = subRouter._findRoute(method, remainder);
        if (found) return found;
      }
    }
    return null;
  }

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    req.query = Object.fromEntries(url.searchParams);

    const found = this._findRoute(req.method, url.pathname);
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const { route, match } = found;
    req.params = {};
    route.paramNames.forEach((name, i) => { req.params[name] = decodeURIComponent(match[i + 1]); });

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      req.body = await parseJsonBody(req);
    } else {
      req.body = {};
    }

    let i = 0;
    const next = async (err) => {
      if (err) return sendError(res, err);
      const handler = route.handlers[i++];
      if (!handler) return;
      try {
        await handler(req, res, next);
      } catch (e) {
        sendError(res, e);
      }
    };
    await next();
  }
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function sendError(res, err) {
  const status = err.status || 500;
  if (!res.headersSent) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
  }
}

function attachHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  res.send = (body) => res.end(body);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { Router, attachHelpers, HttpError };
