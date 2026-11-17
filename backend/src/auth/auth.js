'use strict';
/**
 * Authentication & authorisation.
 * - scrypt password hashes, opaque random session tokens with expiry (server-side).
 * - Roles: viewer (read-only) < operator (handle alarms, log deliveries) < admin (configuration, users, demo controls).
 * - Login throttling: 8 failed attempts per email+IP per 10 minutes.
 * - Only admins can create users; self-registration does not exist.
 */

const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { Router, HttpError, str } = require('../http/router');
const { hashPassword, verifyPassword } = require('./passwords');

const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = db.toSqliteTs(Date.now() + config.SESSION_TTL_MS);
  db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expiresAt]);
  return { token, expiresAt };
}

function userForToken(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const s = db.get('SELECT user_id, expires_at FROM sessions WHERE token = ?', [token]);
  if (!s) return null;
  if (db.tsToMs(s.expires_at) < Date.now()) { db.run('DELETE FROM sessions WHERE token = ?', [token]); return null; }
  return db.get('SELECT id, email, role FROM users WHERE id = ?', [s.user_id]) || null;
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Sign in required');
  const user = userForToken(token);
  if (!user) throw new HttpError(401, 'Session expired or invalid. Please sign in again');
  req.user = user;
  req.token = token;
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    requireAuth(req, res, () => {});
    if ((ROLE_RANK[req.user.role] || 0) < ROLE_RANK[minRole]) {
      throw new HttpError(403, `This action requires the ${minRole} role`);
    }
    next();
  };
}

function audit(userId, action, detail) {
  db.run('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)', [userId ?? null, action, detail ? JSON.stringify(detail) : null]);
}

// --- login throttling (in-memory; per process) ---
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000, MAX_FAILS = 8;
function throttleKey(req, email) { return `${req.socket.remoteAddress}|${String(email).toLowerCase()}`; }
function isThrottled(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(key); return false; }
  return a.count >= MAX_FAILS;
}
function recordFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { first: Date.now(), count: 1 });
  else a.count++;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = new Router();

router.post('/login', (req, res) => {
  const email = str(req.body.email, 'Email', { max: 200 }).toLowerCase();
  const password = str(req.body.password, 'Password', { max: 200 });
  const key = throttleKey(req, email);
  if (isThrottled(key)) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes');
  const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    recordFail(key);
    throw new HttpError(401, 'Incorrect email or password');
  }
  attempts.delete(key);
  const session = createSession(user.id);
  audit(user.id, 'login');
  res.json({ token: session.token, expiresAt: session.expiresAt, user: { id: user.id, email: user.email, role: user.role } });
});

router.post('/logout', requireAuth, (req, res) => {
  db.run('DELETE FROM sessions WHERE token = ?', [req.token]);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Admin user management (replaces the old open self-registration endpoint).
router.get('/users', requireRole('admin'), (req, res) => {
  res.json({ users: db.all('SELECT id, email, role, created_at FROM users ORDER BY id') });
});

router.post('/users', requireRole('admin'), (req, res) => {
  const email = str(req.body.email, 'Email', { max: 200 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address');
  const password = str(req.body.password, 'Password', { max: 200 });
  if (password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  const role = req.body.role || 'operator';
  if (!ROLE_RANK[role]) throw new HttpError(400, 'Role must be viewer, operator or admin');
  if (db.get('SELECT id FROM users WHERE email = ?', [email])) throw new HttpError(409, 'A user with that email already exists');
  const { hash, salt } = hashPassword(password);
  const r = db.run('INSERT INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, ?)', [email, hash, salt, role]);
  audit(req.user.id, 'user.create', { email, role });
  res.status(201).json({ user: { id: Number(r.lastInsertRowid), email, role } });
});

module.exports = { router, requireAuth, requireRole, userForToken, audit, ROLE_RANK };
