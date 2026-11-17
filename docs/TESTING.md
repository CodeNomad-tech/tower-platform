# Testing

## Automated tests

Uses Node's built-in test runner (`node:test`) — no external test
framework dependency.

```bash
cd backend
npm test
# equivalent to: node --experimental-sqlite --test --test-force-exit tests/*.test.js
```

`--test-force-exit` is required because the server under test starts
background `setInterval` jobs (offline-check, SLA re-evaluation) that
would otherwise keep the process alive after tests complete.

### What's covered

`tests/engine.test.js` — unit tests for the rule engine, SLA engine, and
predictive-maintenance engine, run against an in-memory database:
- Low-fuel alerts fire below threshold and not above.
- Duplicate unresolved alerts of the same type/site are suppressed
  (prevents alert-spam).
- Fuel theft detection fires on a sharp drop while the generator is off,
  and does **not** fire during legitimate generator-running consumption.
- Smoke detection always produces a critical alert.
- SLA uptime calculation returns 100% with no downtime logged, and
  correctly computes a reduced percentage after a real logged offline
  period.
- The predictive-maintenance linear regression correctly detects a
  rising trend and correctly returns ~0 slope for a flat trend.

`tests/api.test.js` — integration tests against a real running server
instance (real HTTP requests, real SQLite file, real auth flow):
- Login rejects wrong credentials, accepts the seeded demo admin.
- Protected routes reject unauthenticated requests.
- Site creation, tenancy/occupancy calculation, and the full
  alert acknowledge → resolve lifecycle (with persisted timestamps).
- CSV export produces well-formed output.

## Manual end-to-end verification performed during development

These were run against a live server instance (not just unit-tested) to
confirm the system is genuinely integrated, not just individually correct:

1. **MQTT round-trip:** a real subscriber and real publisher, both using
   the hand-rolled `MqttClient`, exchanged a message through the
   hand-rolled `MqttBroker` over a real TCP socket.
2. **WebSocket round-trip:** the hand-rolled `WsHub` correctly performed
   the RFC 6455 handshake and delivered a broadcast message to Node's
   built-in global `WebSocket` client.
3. **Full pipeline with the fleet simulator running:** booted the server
   with the simulator active, waited several telemetry ticks, and
   confirmed via the REST API that real (non-zero, physically plausible)
   power/fuel/uptime data had been persisted and was queryable.
4. **Camera node → alert, end-to-end:** opened a WebSocket connection (as
   the camera-node page's JS does), sent a `camera-event` message, and
   confirmed a real `intrusion` alert appeared via the Alerts API within
   the same request cycle — proving the "walk in front of the phone,
   watch a real alert fire" claim in the README is actually true, not
   aspirational.
5. **Static asset serving:** confirmed `index.html`, `/js/app.js`, and
   `/css/styles.css` are served correctly by the backend's static file
   handler, and that `/camera-node` correctly serves the phone page from
   outside the main `frontend/` directory.
6. **Frontend JS syntax:** every file under `frontend/js/` was checked
   with `node --check` (a real syntax validation, not just "it looks
   right") before packaging.

## Known gap: no automated browser/UI tests

There is no Selenium/Playwright-style browser automation test suite in
this project. The frontend is plain JS with no build step, which makes
manual browser testing straightforward, but a team continuing this
project should add Playwright coverage for the dashboard's live-update
behavior (WebSocket-driven DOM patching) before scaling beyond a
prototype — that's the one area where "it works when I click through it"
hasn't been converted into a repeatable automated check.
