'use strict';
// Thin wrapper around node:sqlite (built into Node 22+, no external dependency).
// Production note: see docs/DATABASE.md for the Postgres migration path —
// the query shapes here are plain SQL and translate directly.

const path = require('node:path');
const fs = require('node:fs');

let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (e) {
  const hasFlag = process.execArgv.includes('--experimental-sqlite');
  if (!hasFlag) {
    const { spawnSync } = require('node:child_process');
    const args = ['--experimental-sqlite', ...process.execArgv, ...process.argv.slice(1)];
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    process.exit(result.status ?? 0);
  }
  throw e;
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/tower_platform.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}
migrate();

// Convenience helpers -------------------------------------------------------

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

// All timestamps stored via SQLite's datetime('now') use the format
// 'YYYY-MM-DD HH:MM:SS' (space separator, no milliseconds, UTC, no 'Z').
// JS's Date#toISOString() uses a DIFFERENT format ('...T...Z with ms),
// which sorts incorrectly against the SQLite format in plain string
// comparisons. Every timestamp that originates in JS and is compared
// against or inserted into a TEXT timestamp column MUST go through this
// helper so lexicographic string comparison matches chronological order.
function toSqliteTs(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Normalizes any date-ish input (Date object, ISO string from a query
// param, plain 'YYYY-MM-DD', etc.) to the SQLite-comparable format.
function normalizeTs(value) {
  if (value instanceof Date) return toSqliteTs(value);
  return toSqliteTs(new Date(value));
}

module.exports = { db, run, get, all, DB_PATH, toSqliteTs, normalizeTs };
