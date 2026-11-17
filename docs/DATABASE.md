# Database

Engine: **SQLite** via Node's built-in `node:sqlite` (WAL mode). DDL lives in
`backend/src/db/schema.sql` and runs idempotently on every start.

## Entities

```
users ──< sessions                    settings (key/value business assumptions)
users ──< audit_log                   device_keys (sha256 of camera-node keys)
sites ──1 site_assets                 (energy asset register used by the Resilience Engine)
sites ──1 sla_thresholds ──< sla_breaches
sites ──< status_log                  (online | down | offline transitions → availability)
sites ──< power_readings              (grid | solar | battery | generator, active flag)
sites ──< power_switch_events         (to_source 'none' = went dark)
sites ──< battery_readings
sites ──< fuel_readings ──  fuel_deliveries (delivery notes)
sites ──< generator_runtime_log
sites ──< env_readings, security_events
sites ──< tenants
sites ──< alerts (single alarm table, lifecycle new → acknowledged → resolved, resolution_note)
sites ──< maintenance_flags
```

## Notes

* **Timestamps** are UTC text `YYYY-MM-DD HH:MM:SS`. JS values go through
  `db.toSqliteTs()`, and stored values are parsed with `db.tsToMs()` (never
  `new Date(ts)`, which would read them as local time).
* **Status semantics:** `online` = powered; `down` = site controller reports
  no power (tenants off air); `offline` = no telemetry for 3 minutes (comms
  lost, conservatively counted as downtime).
* **Simulated data** is marked by `sites.simulated = 1` and surfaced in the
  API and UI.
* CHECK constraints guard roles, severities, alarm statuses, generator events
  and positive litres. Foreign keys cascade on site deletion.
* Indexes cover every `(site_id, ts)` query path.

## PostgreSQL / TimescaleDB migration

All access goes through `run/get/all/tx` in `db/index.js`. To migrate:
1. Re-implement those four functions on `pg.Pool` (positional `$n` params).
2. `datetime('now')` → `now()`, `AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY`,
   `printf`/`substr` bucketing → `date_trunc`/`time_bucket`.
3. Convert reading tables to Timescale hypertables with retention and
   continuous aggregates (15-min and 1-h rollups feed the timeline and
   utilisation reports directly).
4. Use a migration tool (e.g. node-pg-migrate) instead of run-on-boot DDL.
