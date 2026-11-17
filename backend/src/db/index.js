'use strict';
// Thin wrapper around node:sqlite (built into Node 22.5+, no external dependency).
// See docs/DATABASE.md for the Postgres migration path; call sites use only run/get/all/tx.

const path = require('node:path');
const fs = require('node:fs');
// Older Node 22.x needs --experimental-sqlite. If the server was started with
// plain `node src/server.js`, re-launch once with the flag (idea from the team's version).
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  if (!process.execArgv.includes('--experimental-sqlite') && require.main && require.main.filename) {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.execPath, ['--experimental-sqlite', ...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  throw e;
}
const config = require('../config');

const DB_PATH = config.DB_PATH;
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
if (DB_PATH !== ':memory:') {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
}
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const stmtCache = new Map();
function prepare(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}

function run(sql, params = []) { return prepare(sql).run(...params); }
function get(sql, params = []) { return prepare(sql).get(...params); }
function all(sql, params = []) { return prepare(sql).all(...params); }

// Runs fn inside a single transaction (much faster for bulk inserts).
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// All stored timestamps use 'YYYY-MM-DD HH:MM:SS' (UTC). Date#toISOString()
// uses a different format that sorts incorrectly against it, so every JS
// timestamp that is compared with or inserted into a ts column goes through here.
function toSqliteTs(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}
function normalizeTs(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return toSqliteTs(d);
}
// Parses a stored timestamp back to epoch ms (it is UTC without a 'Z').
function tsToMs(ts) {
  return Date.parse(String(ts).replace(' ', 'T') + 'Z');
}

module.exports = { db, run, get, all, tx, DB_PATH, toSqliteTs, normalizeTs, tsToMs };
