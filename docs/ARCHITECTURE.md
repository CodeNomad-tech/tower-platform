# Architecture

## System overview

```
 Field (real or simulated)                     TowerIQ server (one Node.js process, zero npm dependencies)
 ─────────────────────────                     ────────────────────────────────────────────────────────────
 RMS controller / Wokwi ESP32 ──MQTT──┐
 Fleet simulator (demo mode) ──MQTT──┼──► Embedded MQTT broker :1883 ──► Ingest (validate, persist)
 Vendor firmware (infratel/tower/*) ─┘                                       │
 Phone camera node ──WebSocket (device key)──► re-published to MQTT ─────────┤
                                                                             ▼
                                       ┌──────────── Rule engine ──► alarms ──┐
                          SQLite ◄─────┤ SLA engine (status transitions)      ├──► WebSocket hub :3000/ws ──► Console (SPA)
                     (node:sqlite,     │ Predictive engine (significant trends)│     (session-token auth)
                      WAL mode)        │ Fuel integrity (litre reconciliation) │
                                       └── Resilience Engine (power model +   ─┘
                                           learned grid Markov + Monte Carlo) ──► REST API /api/* (Bearer auth, roles)
```

### Components

| Module | Responsibility |
|---|---|
| `src/server.js` | Wires HTTP, static files (strict CSP), WebSocket, broker, ingest, background jobs, simulator. Graceful shutdown. |
| `src/config.js` | All runtime configuration from environment variables with demo-safe defaults. |
| `src/db/` | Schema (idempotent DDL), connection (WAL, statement cache, transactions), demo seed, demo catalog, simulated-history generator. |
| `src/mqtt/` | Hand-rolled MQTT 3.1.1 broker/client (QoS 0, malformed packets drop the client); `ingest.js` validates and routes telemetry. |
| `src/ws/hub.js` | RFC 6455 WebSocket with handshake authentication: users receive events, devices may only send. |
| `src/http/` | Express-like router (body limit, JSON errors, validation helpers) and route modules. |
| `src/auth/` | scrypt passwords, server-side sessions, roles (viewer < operator < admin), login throttling, audit log. |
| `src/engine/powerModel.js` | The site energy balance ("digital twin"): one function used for history, live simulation and forecasting. |
| `src/engine/gridModel.js` | Load-shedding schedules (simulation/scenarios) and the learned hourly Markov chain (forecasting). |
| `src/engine/resilience.js` | Runway forecast, action queue, upgrade planner. See [RESILIENCE_ENGINE.md](RESILIENCE_ENGINE.md). |
| `src/engine/fuelIntegrity.js` | Litre reconciliation and loss classification. |
| `src/engine/predictiveEngine.js` | Burn-rate and runtime trends with a significance test; fuel flow calibration. |
| `src/engine/ruleEngine.js`, `slaEngine.js` | Alarms with de-duplication and auto-resolve; availability from status transitions. |
| `src/settings.js` | Editable business assumptions (diesel price, SLA credit multiplier, capex costs, policies). |
| `src/simulators/fleetSimulator.js` | Real-time simulated RMS for demo sites + admin scenario controls. |
| `frontend/` | Vanilla JS SPA, no build step. `core.js` (escaping templates, API, live feed, router), `charts.js` (SVG), `pages/*`. |

## Key design decisions

1. **One physics model, three uses.** History, live simulation and forecasts
   all call `powerModel.step`. The demo cannot show behaviour the forecaster
   would not predict, and the forecaster can be unit-tested against simple
   energy arithmetic.
2. **Learn from the site, don't hard-code the grid.** Forecasts use a Markov
   chain estimated from each site's own telemetry. Scenarios (8/12/18 h/day)
   are explicit "what-ifs", never confused with the learned forecast.
3. **Nameplate vs. measured burn.** The forecast uses the measured drain (what
   the tank really loses). Fuel Integrity uses the nameplate rate, so theft is
   not absorbed into "normal".
4. **Reads never write.** GET endpoints compute only. Breach records and
   maintenance flags are persisted by background jobs at most once per day per
   site.
5. **Same-origin, defence in depth.** Console and API share an origin. The
   strict CSP has `script-src 'self'` and no inline handlers. All dynamic text
   is escaped in a tagged template. CSV cells are neutralised against formula
   injection. Sessions are stored in `sessionStorage`, not `localStorage`.
6. **Zero runtime dependencies.** The whole system starts with `npm start` and
   no internet access, which matters for a venue demo and for low-bandwidth
   deployments. Production upgrade paths are listed below.

## Data flow: telemetry to action

1. A device publishes `sites/CPB-007/fuel {"level_pct": 9.1, "generator_on": true}`.
2. Ingest validates the site and value ranges, inserts into `fuel_readings`,
   and calls `ruleEngine.evaluateFuel`. The rules convert to litres using the
   tank size, check the low-fuel threshold, and check for a sudden drop with
   the generator off over 15 minutes.
3. New alarms are broadcast on the WebSocket; the console updates its badge,
   toasts and queue.
4. Every minute the forecast cache is invalidated and clients are nudged. The
   next runway request recalibrates (burn rate, standing loss, grid Markov)
   and re-runs the Monte Carlo.
5. The action queue converts forecasts and open security alarms into ranked,
   deadline-bound actions valued in Kwacha.
6. The operator logs a delivery. It is recorded with user and time in the
   audit log; in demo mode the simulated tank fills, and the next tick
   changes the forecast.

## Production upgrade path

| Component | Now | Production |
|---|---|---|
| Database | SQLite (WAL) | PostgreSQL + TimescaleDB hypertables for readings; retention/rollups |
| MQTT | Embedded broker, no auth | EMQX/Mosquitto/HiveMQ with TLS and per-device credentials; ACLs per site topic |
| Auth | Sessions + roles | Plus SSO (OIDC) for staff; per-tenant viewer accounts |
| Forecast compute | In-process, cached | Worker pool / job queue; incremental per-site refresh on new telemetry |
| Frontend | Vanilla SPA | Unchanged API contract; can migrate to a component framework if the team grows |
| Notifications | In-app toasts | SMS/WhatsApp escalation for unacknowledged critical alarms |
