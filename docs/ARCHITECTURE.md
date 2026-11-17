# Architecture

## System overview

```
┌─────────────────────┐        ┌──────────────────────┐
│  Wokwi ESP32 node    │        │  Fleet simulator      │
│  (real firmware,     │        │  (Node process,       │
│  real WiFi+MQTT)     │        │  same MQTT schema)    │
└──────────┬───────────┘        └───────────┬───────────┘
           │ MQTT (real 3.1.1 protocol)      │
           └───────────────┬──────────────────┘
                            ▼
                  ┌───────────────────┐
                  │  Embedded MQTT     │   backend/src/mqtt/broker.js
                  │  broker (:1883)    │
                  └─────────┬──────────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │  Ingest service    │   backend/src/mqtt/ingest.js
                  │  (subscribes to    │
                  │  all topics)       │
                  └─────────┬──────────┘
                            │
              ┌─────────────┼─────────────────┐
              ▼             ▼                 ▼
     ┌────────────┐ ┌───────────────┐ ┌───────────────┐
     │  SQLite DB  │ │  Rule engine   │ │  WebSocket hub │
     │ (node:sqlite│ │ (alerts, SLA,  │ │  (:3000/ws)    │
     │  built-in)  │ │  predictive)   │ │                │
     └─────────────┘ └───────────────┘ └───────┬────────┘
                                                 │ live JSON events
                                                 ▼
                                    ┌────────────────────────┐
                                    │  Frontend SPA            │
                                    │  (vanilla JS, no build)  │
                                    │  + Phone camera node      │
                                    │  (getUserMedia, on-device │
                                    │  motion detection)        │
                                    └────────────────────────┘
```

Every device — real (Wokwi ESP32) or simulated (fleet simulator) —
publishes to the **same MQTT topic scheme and JSON payload shape**
(documented in `docs/API.md`). The backend cannot distinguish a real
device from a simulated one, which is the point: the pipeline is
identical whether or not physical hardware exists yet.

The phone camera node is the one component that can't speak MQTT
directly (browsers can't open raw TCP sockets), so it publishes over the
same WebSocket connection used for dashboard updates; the backend
re-publishes those events onto the MQTT bus so they still flow through
the identical ingest → rule engine → alert pipeline as everything else.

## Why zero dependencies

This build environment has no internet access for `npm install`, so
rather than deliver untested code written on faith, every layer was
built on Node.js built-ins and verified running in this session:

- **HTTP server & router** — `node:http` + a small hand-rolled router
  (`backend/src/http/router.js`), API-compatible in shape with Express.
- **Database** — `node:sqlite` (built into Node 22.5+), a real embedded
  SQL database, not an in-memory mock.
- **MQTT broker & client** — hand-rolled implementation of MQTT 3.1.1
  (QoS 0) on `node:net` (`backend/src/mqtt/broker.js`, `client.js`).
  Real wire protocol — a genuine ESP32 running PubSubClient.h connects to
  it exactly as it would to Mosquitto.
- **WebSocket server** — hand-rolled RFC 6455 implementation on
  `node:http`'s `upgrade` event (`backend/src/ws/hub.js`).
- **Auth** — `node:crypto` scrypt password hashing + random session
  tokens (no `bcrypt` or `jsonwebtoken` package needed).
- **Frontend** — plain HTML/CSS/JS, no bundler, no framework, no build
  step. Charts are a small hand-rolled canvas renderer
  (`frontend/js/charts.js`).

This has a real benefit beyond working without internet access: **the
entire project runs with just `node server.js`**, which is valuable for
a live hackathon demo where venue WiFi is unreliable.

### Production upgrade path

None of the above is a permanent constraint — it's a deliberate choice
for portability, documented per-module with a clear swap path:

| Component | Current (zero-dep) | Production upgrade |
|---|---|---|
| HTTP framework | Hand-rolled router | Express or Fastify (the router API shape mirrors Express closely — migration is mechanical) |
| Database | SQLite (`node:sqlite`) | PostgreSQL — see `docs/DATABASE.md` for the migration notes; the SQL used is plain, portable SQL |
| MQTT broker | Embedded hand-rolled broker | Managed broker (HiveMQ Cloud, EMQX Serverless free tiers) or self-hosted Mosquitto; devices need zero code changes, just a different host/port |
| Auth | Session tokens in SQLite | Same approach works fine at scale; alternatively JWT via `jsonwebtoken` if statelessness is needed |
| Frontend | Vanilla JS SPA | React/Vite, if the team wants component reuse and a richer ecosystem — the API/WS contracts don't change |
| CCTV | Phone browser + on-device motion detection | Dedicated IP cameras with an NVR, or the same phone-node pattern deployed permanently with a mounted device |

## Data flow: how a value becomes an alert

1. A device (real or simulated) publishes JSON telemetry to a topic like
   `sites/site-001/fuel`.
2. The embedded MQTT broker forwards it to the ingest service, which is
   subscribed to `sites/+/fuel` (and all other channels).
3. The ingest service persists the reading to `fuel_readings` and calls
   `ruleEngine.evaluateFuel()`.
4. The rule engine checks the reading against thresholds (and, for theft
   detection, against the site's fuel history over the trailing window)
   and — if warranted — inserts a row into `alerts`.
5. The new alert is broadcast over the WebSocket hub to every connected
   dashboard client.
6. The frontend's `Live.on()` listener receives the event and updates the
   relevant UI (site card badge, alert feed) without a page reload.
7. An operator acknowledges/resolves the alert from the UI; that state
   change is persisted, and feeds into the real
   mean-time-to-acknowledge/resolve metric on the Alerts page.

This is the same pipeline for every alert type — low fuel, fuel theft,
smoke, intrusion (camera or door sensor), SLA breach, and predictive
maintenance flags — by design, so adding a new alert type is "one more
rule function," not new plumbing.

## Realism in the fleet simulator

The simulator (`backend/src/simulators/fleetSimulator.js`) deliberately
avoids random noise:

- Solar output follows an actual diurnal curve (`cos` bell curve peaking
  at local noon, zero outside 6am–6pm).
- Fuel only drains while the generator is actually running, at a fixed
  rate — not randomly.
- Power source switching follows a real priority order (grid > solar >
  generator) based on a simulated grid-up/grid-down state.
- Anomaly events (a brief grid outage, an occasional theft-pattern fuel
  drop, rare smoke events) are injected deliberately and infrequently —
  documented here, not hidden — specifically to exercise the alert
  pipeline in a demo.
