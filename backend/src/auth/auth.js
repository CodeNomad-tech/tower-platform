'use strict';
/**
 * Authentication: scrypt password hashing (node:crypto, real KDF, no
 * external bcrypt dependency) + opaque random session tokens stored
 * server-side with expiry (simpler and equally secure for this project
 * than hand-rolling JWT signing — no libraries either way).
 */

const crypto = require('node:crypto');
const db = require('../db');
const { Router, HttpError } = require('../http/router');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = db.toSqliteTs(new Date(Date.now() + SESSION_TTL_MS));
  db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expiresAt]);
  return { token, expiresAt };
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Missing Authorization header');

  const session = db.get('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!session) throw new HttpError(401, 'Invalid session token');
  if (new Date(session.expires_at) < new Date()) {
    db.run('DELETE FROM sessions WHERE token = ?', [token]);
    throw new HttpError(401, 'Session expired');
  }
  const user = db.get('SELECT id, email, role FROM users WHERE id = ?', [session.user_id]);
  req.user = user;
  next();
}

const router = new Router();

router.post('/register', (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || password.length < 8) {
    throw new HttpError(400, 'email and password (min 8 chars) are required');
  }
  const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) throw new HttpError(409, 'A user with that email already exists');

  const { hash, salt } = hashPassword(password);
  const result = db.run(
    'INSERT INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, ?)',
    [email, hash, salt, role === 'admin' ? 'admin' : 'operator']
  );
  const session = createSession(Number(result.lastInsertRowid));
  res.status(201).json({ token: session.token, user: { email, role: role || 'operator' } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password || '', user.password_hash, user.password_salt)) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const session = createSession(user.id);
  res.json({ token: session.token, user: { email: user.email, role: user.role } });
});

router.post('/logout', requireAuth, (req, res) => {
  const header = req.headers['authorization'] || '';
  const token = header.slice(7);
  db.run('DELETE FROM sessions WHERE token = ?', [token]);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = { router, requireAuth, hashPassword };
