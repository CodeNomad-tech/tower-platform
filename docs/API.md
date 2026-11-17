# API Reference

Base URL: `/api`. JSON in and out. Authenticate with `Authorization: Bearer <token>`
from `POST /auth/login`. Roles: **viewer** (read) < **operator** (alarms,
deliveries) < **admin** (configuration, users, demo controls). Errors return
`{ "error": "message" }` with 400 (validation), 401, 403, 404, 409 (conflict),
413 (body > 256 KB), 429 (login throttled) or 500.

## Public
| Method | Path | Description |
|---|---|---|
| GET | `/meta` | Product name, version, demo mode flag, simulated-data notice |
| GET | `/meta/health` | Liveness + ingest counters (accepted/rejected messages) |
| POST | `/auth/login` | `{ email, password }` → `{ token, expiresAt, user }`. 8 failures per email+IP per 10 min → 429 |

## Auth & users
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/logout` | any | Ends the session |
| GET | `/auth/me` | any | Current user |
| GET | `/auth/users` | admin | List users |
| POST | `/auth/users` | admin | `{ email, password (≥10), role }`. There is no public self-registration |

## Sites
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/sites` | viewer | All sites with current supply, fuel %, battery %, tenants, open alarms |
| POST | `/sites` | admin | `{ id, name, region?, latitude?, longitude?, capacity? }` (id: letters/digits/-/_) |
| GET | `/sites/:id` | viewer | Detail: assets, latest readings, tenants, switch log, security events, 24 h availability, 30 d SLA, maintenance flags, fuel reconciliation |
| PUT | `/sites/:id/assets` | admin | Energy asset register (load, battery, solar, tank, generator, nameplate burn, refuel lead time) |
| GET | `/sites/:id/forecast?loadShedding=` | viewer | Blackout runway (300 runs). Omit `loadShedding` for the learned pattern |
| GET | `/sites/:id/timeline?hours=24` | viewer | 15-min buckets: majority source (incl. `none`=dark), fuel %, battery %, plus deliveries and theft markers |
| GET | `/sites/:id/power-utilization?period=daily\|weekly\|monthly\|quarterly\|yearly` | viewer | Share of hours per source incl. `dark`, with data-coverage days |
| GET | `/sites/:id/uptime?from=&to=` | viewer | Availability % for any range |
| GET | `/sites/:id/fuel-history?from=&to=` | viewer | Fuel level in 15-min buckets |

## Resilience Engine
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/resilience/runway?loadShedding=` | viewer | Fleet forecast: risk level, P(dark 24/72 h), median time to dark, act-by, cause, exposure |
| GET | `/resilience/actions` | viewer | Ranked action queue: `{ kind: restore\|refuel\|capacity\|alarm, priority, title, detail, deadline, valueK, litres, basis }` |
| GET | `/resilience/plan?loadShedding=&budget=` | viewer | Upgrade planner: per-site baseline and options, funded plan, fleet totals, assumptions |
| GET | `/resilience/plan.csv?loadShedding=&budget=` | viewer | The ranked plan as CSV |

## Alarms
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/alerts?status=open\|new\|acknowledged\|resolved&severity=&siteId=&limit=` | viewer | Alarm list (unresolved first) |
| POST | `/alerts/:id/acknowledge` | operator | 409 if not `new` |
| POST | `/alerts/:id/resolve` | operator | `{ note? }`. Also acknowledges if not yet acknowledged |
| GET | `/alerts/metrics/mttx?days=30` | viewer | Mean time to acknowledge/resolve, open counts by severity |

Alarm types: `site_down`, `comms_lost`, `low_fuel`, `fuel_theft`, `smoke`,
`equipment_health`, `intrusion`, `unauthorized_access`, `sla_breach`.

## Fuel
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/fuel/integrity?days=30` | viewer | Fleet reconciliation and findings |
| GET | `/fuel/integrity/:siteId?days=` | viewer | One site |
| GET | `/fuel/deliveries?siteId=` | viewer | Delivery notes |
| POST | `/fuel/deliveries` | operator | `{ siteId, litres, supplier?, reference? }`. In demo mode the simulated tank receives the fuel |

## Commercial
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/tenancy` | viewer | Per-site tenants, occupancy, revenue, free-slot opportunity, availability, SLA credit exposure; fleet totals incl. tenancy ratio |
| GET | `/tenancy/opportunities` | viewer | Free slots ranked by opportunity, with "sellable" flag (availability ≥ 99%) |
| POST | `/tenancy/:siteId/tenants` | admin | `{ name, contract_value_monthly }` (409 at capacity) |
| DELETE | `/tenancy/:siteId/tenants/:tenantId` | admin | 404 if not found |

## Reports
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/reports/sla?periodDays=` or `?period=daily…yearly` | viewer | Automated SLA report |
| GET | `/reports/sla/breaches` | viewer | Recorded breaches (background job) |
| GET | `/reports/utilization?period=` | viewer | Fleet + per-site source utilisation |
| GET | `/reports/predictive-maintenance` | viewer | Current significant trends |
| GET | `/reports/executive-summary` | viewer | Fleet KPIs |
| GET | `/reports/export/sla.csv`, `/alerts.csv`, `/fuel.csv` | viewer | CSV exports (formula-injection safe) |

## Settings, SLA, demo
| Method | Path | Role | Description |
|---|---|---|---|
| GET / PUT | `/settings` | viewer / admin | Business assumptions (validated ranges) |
| POST / GET | `/settings/device-keys` | admin | Create (key shown once) / list camera-node keys |
| GET | `/settings/audit` | admin | Audit log |
| GET / PUT | `/sla`, `/sla/:siteId` | viewer / admin | Per-site availability targets (90–100%) |
| GET | `/demo/status` | viewer | Simulator state (demo mode) |
| POST | `/demo/scenario` | admin | `{ siteId, action: outage\|restore\|siphon\|intrusion\|smoke, hours?, litres? }` |

## WebSocket `/ws`
* Console: `/ws?token=<session token>`. It receives JSON events with `channel`:
  `heartbeat`, `status`, `power`, `battery`, `fuel`, `generator`, `env`,
  `security`, `switch`, `alert`, `maintenance`, `forecast`.
* Device: `/ws?device=<device key>`. It receives `{type:'hello', sites}` and may
  send `{ type: 'camera-event', siteId, event_type: 'motion'|'intrusion'|'unauthorized_access', confidence }`.
* No credentials → HTTP 401 during the handshake.

## MQTT device contract (port 1883)

| Topic | Payload |
|---|---|
| `sites/{siteId}/heartbeat` | `{ powered?: bool }` (false = site dark; default true) |
| `sites/{siteId}/power` | `{ source: grid\|solar\|battery\|generator, active: bool, voltage?, output_watts? }`, one message per source |
| `sites/{siteId}/battery` | `{ soc_pct: 0–100, voltage? }` |
| `sites/{siteId}/fuel` | `{ level_pct: 0–100, generator_on: bool }` |
| `sites/{siteId}/generator` | `{ event: start\|stop }` |
| `sites/{siteId}/env` | `{ temperature_c?, smoke_detected, door_open, motion_detected }` |
| `sites/{siteId}/security` | `{ event_type, source, confidence? 0–1 }` |

Messages for unknown sites, or with out-of-range values, are rejected and
counted in `/meta/health`. A vendor adapter for `infratel/tower/{TWR-xxx}/telemetry|events|status`
maps into the same channels (see `mqtt/ingest.js`).
