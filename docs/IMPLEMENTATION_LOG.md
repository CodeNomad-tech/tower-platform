# Implementation Log, Status and Roadmap

## Log (2026-11-17)

| # | Change | Why | Verified by |
|---|---|---|---|
| 1 | Found full project at `~/Documents/smart_tower-platform/tower-platform` (ZIP lacked backend); created isolated repo `~/Documents/My Projects/towerIQ`, baseline commit `6e007a9` | Preserve originals; work on a copy | `git log` |
| 2 | Forensic audit: ran original 20 tests (pass), booted server, probed API | Understand before changing | [AUDIT.md](AUDIT.md) |
| 3 | Closed open admin self-registration; added role enforcement, login throttling, audit log, admin-only user creation | Critical security defect (verified exploitable) | API tests |
| 4 | WebSocket handshake auth (session token or device key); devices send-only, consoles receive-only | Unauthenticated alarm injection and data exposure | API tests |
| 5 | Body-size limit, malformed JSON → 400, input validation, security headers + strict CSP, safe static path resolution, MQTT broker survives malformed packets | Robustness / hardening | API tests |
| 6 | Asset model (`site_assets`), battery telemetry, `down` status, delivery notes, settings, device keys, audit log | Required for physics-based reasoning and money | Schema + tests |
| 7 | Site power model + grid model; simulated 12-site fleet with 30-day physically simulated history; live simulator resumes from history | Fresh DB had nothing to show; demo must be meaningful and honest | Manual probes + tests |
| 8 | Resilience Engine: runway, action queue, planner + CSV | Signature innovation | Engine + API tests, screenshots |
| 9 | Fuel Integrity reconciliation; litres-based theft rules | Measurable loss, not percentages | Engine tests |
| 10 | Predictive maintenance rewritten with significance test (t ≥ 3) and ≥10% change; no writes on GET | Original flagged noise; GETs grew the DB | Tests (rising flagged, noisy flat not flagged) |
| 11 | Fixed: dashboard data-contract bug, hardcoded revenue fallback, false power-switch log, broken CSV links, localhost-hardcoded API origin, timestamp parsing as local time, utilisation by row count | Correctness | Tests + browser screenshots |
| 12 | New console (9 screens), escaping templates, light/dark themes, responsive | Clarity for operators and judges | Headless Chrome at 1440 px and 390 px: no JS errors, no horizontal overflow |
| 13 | Camera node: device-key pairing, sustained motion → intrusion | Security + fewer false alarms | API test (device vs user socket) |
| 14 | Tuning found and fixed: generator stop logged one step early (fake losses), measured-burn bias from zero-change intervals, `0 h` shown as `1 min`, 413 reset the connection | Bugs found during validation | Re-run probes + tests |
| 15 | Docs: strategy, resilience engine, commercialisation, demo script, pitch, API, architecture | Competition readiness | This folder |

## Test status

`cd backend && npm test`: **36 tests, 36 passing** (last run 2026-11-17).
Covers the power model, schedules, rules, SLA, predictive significance, fuel
reconciliation, resilience monotonicity, the planner, security (auth, roles,
WebSocket auth, device keys, traversal, body limits, headers), all major API
routes, the demo theft scenario end-to-end, and ingest validation.

UI verified with headless Chrome via the DevTools protocol (every page,
desktop and phone width, dark and light): zero console errors or exceptions.
There is no automated UI regression suite yet.

## Not verified (needs equipment, credentials or real data)

* Real RMS hardware or real Infratel telemetry. **Forecast accuracy is
  therefore unvalidated** outside simulation.
* The Wokwi sketch was updated, but not re-run in Wokwi in this session (it
  needs a publicly reachable broker).
* The phone camera node over HTTPS on a physical phone (needs a tunnel or TLS).
  The device-key path is covered by an automated test.
* Throughput above the 12-site demo fleet.

## Known limitations

* SQLite and the embedded MQTT broker suit a single server. The MQTT broker has
  no authentication (documented production path: managed broker with TLS).
* Business assumptions (SLA credit multiplier, capex costs) are placeholders.
* Demo tenant contract values are illustrative; tenant names are real
  operators used as examples on fictional sites.
* No SMS/e-mail escalation and no work-order management yet.
* No data-retention job: live telemetry grows by ~35k rows per hour for 12
  simulated sites.

## Roadmap

| Priority | Item |
|---|---|
| P1 (pilot) | Back-test harness on historical data (Brier score, theft precision/recall) · ZESCO schedule import · SMS escalation · retention/rollups |
| P2 | Postgres/TimescaleDB · managed MQTT + per-device credentials · SSO · work orders linked to actions · Playwright UI tests |
| P3 | Refuel route optimisation across sites · TF.js person detection on camera node · generator remote start/stop · ILP-optimal planner · map view |
