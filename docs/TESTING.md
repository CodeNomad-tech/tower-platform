# Testing

```bash
cd backend
npm test        # node:test, zero dependencies; ~6 s
```

Each test file runs in its own process with its own database:

* `tests/engine.test.js` (in-memory DB, no server): power-model energy balance
  and generator logic; load-shedding schedules; rule engine (litres, theft vs.
  legitimate burn, de-duplication, auto-resolve); SLA maths and no-write
  guarantee; predictive regression and significance test (a rising trend is
  flagged, a flat noisy one is not); fuel reconciliation on synthetic siphoning
  data; resilience forecast monotonicity and cause detection; planner benefit.
* `tests/api.test.js` (real server on test ports, simulator at a 400 ms tick,
  6 days of history): meta notice, login per role, removed self-registration,
  role enforcement, malformed/oversized bodies, security headers, path
  traversal, WebSocket authentication, device-key camera events vs. user-socket
  injection, sites CRUD validation, utilisation periods, runway/actions/planner
  invariants, plan CSV, the live theft scenario end-to-end, the alarm
  lifecycle, deliveries, settings validation and audit, reports and CSV
  exports, and ingest rejection of malformed telemetry.

Last run: **36/36 passing** (2026-11-17).

## UI verification

There is no Playwright suite yet (roadmap). During development every console
page was driven with headless Chrome over the DevTools protocol at 1440×900
and 390×844, in dark and light themes. The checks were: sign-in through the
real form, page text rendered, no horizontal overflow, and zero console errors
or uncaught exceptions. The script was a development aid and is not in the repo.

## Manual demo check (2 minutes)

1. `npm run demo:reset && npm start`, then sign in as admin.
2. Command Center headline names at-risk towers; the queue has a critical
   Kasama Hill refuel.
3. Settings → siphon 150 L at Livingstone Relay → within ~10 s a theft
   alarm and action appear.
4. Planner slider 8 → 18 h/day changes dark hours and the ranking. Export CSV
   downloads.
