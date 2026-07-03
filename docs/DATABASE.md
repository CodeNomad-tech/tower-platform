# Database Schema

Engine: **SQLite** via Node's built-in `node:sqlite` module (no external
driver). Full DDL lives in `backend/src/db/schema.sql` and runs
automatically on every server start (idempotent — uses `CREATE TABLE IF
NOT EXISTS`).

## Entity-relationship summary

```
users ──< sessions
sites ──< status_log            (uptime/SLA calculation basis)
sites ──< power_readings ──< power_switch_events
sites ──< fuel_readings ──< generator_runtime_log
sites ──< env_readings
sites ──< security_events
sites ──< tenants                (commercial intelligence)
sites ──1 sla_thresholds ──< sla_breaches
sites ──< alerts
sites ──< maintenance_flags
```

## Table reference

**users** — `id, email (unique), password_hash, password_salt, role, created_at`
scrypt-hashed passwords (`node:crypto`), never stored in plaintext.

**sessions** — `token (PK), user_id, created_at, expires_at`
Opaque random session tokens, 12h expiry, checked on every authenticated request.

**sites** — `id (PK, e.g. 'site-001'), name, region, latitude, longitude, capacity, status, last_heartbeat, created_at`
`status` is one of `online | offline | degraded | unknown`, updated by the
offline-detection background job (`ruleEngine.checkOfflineSites`) based on
`last_heartbeat` recency.

**status_log** — `id, site_id, status, ts`
Append-only log of every status transition. This is the ground truth
`slaEngine.computeUptimePct()` reconstructs uptime % from — not a stored
percentage, a real calculation over transition history.

**power_readings** — `id, site_id, source ('grid'|'solar'|'generator'), active, voltage, output_watts, ts`
One row per source per telemetry tick; `active` marks which source is
currently supplying power.

**power_switch_events** — `id, site_id, from_source, to_source, reason, ts`
Logged whenever the active source changes — backs the "automatic power
switching visibility" requirement with a real event log, not just a
current-state field.

**fuel_readings** — `id, site_id, level_pct, generator_on, ts`
Backs fuel level monitoring, consumption analytics, and theft detection
(comparing consecutive readings' deltas).

**generator_runtime_log** — `id, site_id, event ('start'|'stop'), ts`
Backs generator runtime tracking and the predictive-maintenance
runtime-trend signal.

**env_readings** — `id, site_id, temperature_c, smoke_detected, door_open, motion_detected, ts`

**security_events** — `id, site_id, event_type, source, confidence, ts`
Raw log of every motion/intrusion/unauthorized-access detection, from
either the PIR sensor (Wokwi) or the phone camera node.

**tenants** — `id, site_id, name, contract_value_monthly, start_date`
Backs occupancy %, revenue, and the revenue-opportunity report (capacity
gap × average contract value across all tenants).

**sla_thresholds** — `site_id (PK), target_uptime_pct`
Configurable per site (default 99.5%).

**sla_breaches** — `id, site_id, period_start, period_end, target_pct, actual_pct, ts`
Written by the SLA engine whenever a rolling-period check falls below target.

**alerts** — `id, site_id, type, severity, message, status ('new'|'acknowledged'|'resolved'), source_data (JSON), created_at, acknowledged_at, acknowledged_by, resolved_at, resolved_by`
The single shared table every alert type writes to — see
`docs/ARCHITECTURE.md` for why this is deliberately unified rather than
per-feature.

**maintenance_flags** — `id, site_id, component, trend_slope, explanation, created_at`
Written by the predictive-maintenance engine with a real computed slope
and a human-readable explanation, not just a risk label.

## Timestamp convention (important if you extend this)

Every `ts`/`created_at`/etc. column defaults to SQLite's
`datetime('now')`, which produces the format `YYYY-MM-DD HH:MM:SS` (UTC,
space-separated, no milliseconds). Any timestamp generated in JavaScript
that will be **compared against or inserted alongside** these columns
**must** go through `db.toSqliteTs(date)` or `db.normalizeTs(value)`
(`backend/src/db/index.js`) first — `Date#toISOString()` uses a different
format (`T`/`Z`/milliseconds) that sorts incorrectly against SQLite's
format in plain string comparisons. This bit us once during development;
every call site in this codebase already goes through the helper, and
the test suite (`backend/tests/engine.test.js`) exercises the
cross-boundary comparisons that would catch a regression.

## PostgreSQL migration path

The SQL used throughout (`backend/src/**/*.js`) is plain, portable SQL —
no SQLite-specific syntax beyond `datetime('now')` and
`INSERT ... ON CONFLICT DO UPDATE` (both of which have direct Postgres
equivalents: `NOW()` and the same `ON CONFLICT` clause, which Postgres
also supports natively). To migrate:

1. Replace `backend/src/db/index.js` with a `pg` (node-postgres) client
   exposing the same `run/get/all` function signatures used throughout
   the codebase — every call site stays unchanged.
2. Replace `datetime('now')` with `NOW()` in `schema.sql`.
3. Replace `AUTOINCREMENT` with `SERIAL` / `GENERATED ALWAYS AS IDENTITY`.
4. Add proper connection pooling (`pg.Pool`) and run schema migrations
   via a tool like `node-pg-migrate` instead of the current "run
   schema.sql on boot" approach, which is fine for SQLite but not for a
   multi-instance Postgres deployment.
