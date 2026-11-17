# API Reference

## Authentication

All `/api/*` routes except `/api/auth/login` and `/api/auth/register`
require a bearer token:

```
Authorization: Bearer <token>
```

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create a new user. Body: `{ email, password, role? }`. Password min 8 chars. |
| POST | `/api/auth/login` | Log in. Body: `{ email, password }`. Returns `{ token, user }`. |
| POST | `/api/auth/logout` | Invalidate the current session token. |
| GET | `/api/auth/me` | Returns the current authenticated user. |

## Sites (infrastructure monitoring)

| Method | Path | Description |
|---|---|---|
| GET | `/api/sites` | List all sites with current status. |
| POST | `/api/sites` | Create a site. Body: `{ id, name, region?, latitude?, longitude?, capacity? }`. |
| GET | `/api/sites/:id` | Site detail: latest power/fuel/env readings, 24h uptime, tenant count. |
| GET | `/api/sites/:id/uptime?from=&to=` | Uptime % for an arbitrary date range. |
| GET | `/api/sites/:id/power-history?from=&to=&source=` | Raw power readings for charting. |
| GET | `/api/sites/:id/fuel-history?from=&to=` | Raw fuel readings for charting. |
| GET | `/api/sites/:id/power-utilization?period=daily\|weekly\|monthly\|quarterly\|yearly` | % of time each power source was active. |

## Alerts (alarm management)

| Method | Path | Description |
|---|---|---|
| GET | `/api/alerts?status=&siteId=` | List alerts, optionally filtered. |
| POST | `/api/alerts/:id/acknowledge` | Mark an alert acknowledged (records who + when). |
| POST | `/api/alerts/:id/resolve` | Mark an alert resolved (records who + when). |
| GET | `/api/alerts/metrics/mttx` | Real mean-time-to-acknowledge / mean-time-to-resolve, computed from alert timestamps. |

## Tenancy (commercial intelligence)

| Method | Path | Description |
|---|---|---|
| GET | `/api/tenancy` | Per-site occupancy %, tenant count, monthly revenue. |
| GET | `/api/tenancy/opportunities` | Sites with empty capacity, ranked by estimated monthly revenue opportunity. |
| POST | `/api/tenancy/:siteId/tenants` | Add a tenant. Body: `{ name, contract_value_monthly }`. |
| DELETE | `/api/tenancy/:siteId/tenants/:tenantId` | Remove a tenant. |

## SLA

| Method | Path | Description |
|---|---|---|
| GET | `/api/sla` | Current SLA thresholds per site. |
| PUT | `/api/sla/:siteId` | Set a site's SLA target. Body: `{ target_uptime_pct }`. |

## Reports & analytics

| Method | Path | Description |
|---|---|---|
| GET | `/api/reports/sla?periodDays=30` | SLA compliance report across all sites for a period. |
| GET | `/api/reports/sla/breaches` | Historical SLA breach log. |
| GET | `/api/reports/predictive-maintenance` | Current predictive-maintenance flags with explanations. |
| GET | `/api/reports/executive-summary` | Fleet-wide KPIs for the executive dashboard. |
| GET | `/api/reports/export/uptime.csv` | Downloadable uptime report. |
| GET | `/api/reports/export/alerts.csv` | Downloadable alert log. |

## WebSocket (`/ws`)

Connect to `ws://<host>/ws` (or `wss://` behind TLS). No auth handshake
is required for the socket itself (the dashboard already required an
authenticated session to load); every message is a JSON object.

**Server → client** events (all share a `channel` field):

```jsonc
{ "channel": "heartbeat", "siteId": "site-001" }
{ "channel": "power", "siteId": "site-001", "payload": { "source": "solar", "active": true, "voltage": 221.4, "output_watts": 812 } }
{ "channel": "fuel", "siteId": "site-001", "payload": { "level_pct": 42.1, "generator_on": false } }
{ "channel": "env", "siteId": "site-001", "payload": { "temperature_c": 31.2, "smoke_detected": false, "door_open": false, "motion_detected": true } }
{ "channel": "security", "siteId": "site-001", "payload": { "event_type": "motion", "source": "pir", "confidence": 0.87 } }
{ "channel": "alert", "siteId": "site-001", "alert": { "id": 12, "type": "low_fuel", "severity": "warning", "message": "...", "status": "new" } }
{ "channel": "sla", "siteId": "site-001", "result": { "actualPct": 98.2, "targetPct": 99.5, "breached": true } }
{ "channel": "maintenance", "siteId": "site-001", "flag": { "component": "generator", "trendSlope": 4.1, "explanation": "..." } }
```

**Client → server** (used by the phone camera node, which can't speak
raw MQTT from a browser):

```jsonc
{ "type": "camera-event", "siteId": "site-001", "event_type": "motion" | "intrusion", "confidence": 0.91 }
```

## MQTT topic schema (device ↔ backend)

Any device — Wokwi ESP32, the fleet simulator, or real future hardware —
publishes to these topics against the embedded broker on port `1883`
(configurable via `MQTT_PORT`):

| Topic | Payload | Published by |
|---|---|---|
| `sites/{siteId}/heartbeat` | `{}` | any device, periodically, to signal "I'm alive" |
| `sites/{siteId}/power` | `{ source: "grid"\|"solar"\|"generator", active: bool, voltage: number, output_watts: number }` | one message per source per tick |
| `sites/{siteId}/fuel` | `{ level_pct: number, generator_on: bool }` | |
| `sites/{siteId}/generator` | `{ event: "start" \| "stop" }` | on state transitions only |
| `sites/{siteId}/env` | `{ temperature_c: number, smoke_detected: bool, door_open: bool, motion_detected: bool }` | |
| `sites/{siteId}/security` | `{ event_type: "motion"\|"intrusion"\|"unauthorized_access", source: string, confidence: number }` | |

This is the contract a real device must follow to be indistinguishable
from the simulator — see `hardware-simulation/wokwi/sketch.ino` for a
reference implementation, and `backend/src/simulators/fleetSimulator.js`
for the simulated fleet using the identical schema.
