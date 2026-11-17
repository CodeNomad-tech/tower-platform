# Smart Tower Monitoring & Infrastructure Intelligence Platform

A full-stack prototype for telecom tower and infrastructure monitoring —
uptime/SLA tracking, power management (grid/solar/generator), fuel &
generator intelligence (including theft detection), environmental &
security monitoring (with real phone-camera CCTV), commercial/tenancy
intelligence, and reporting & analytics with predictive maintenance
indicators.

Built for a hackathon prototype with **zero purchased hardware** and
**zero paid cloud services** — but architected exactly as it would be for
a real deployment. See [`docs/HARDWARE_SIMULATION.md`](docs/HARDWARE_SIMULATION.md)
for exactly what's simulated, why, and how to swap in the real thing.

## What makes this "real" and not a mockup

- **Real MQTT protocol** (hand-rolled 3.1.1 broker + client, zero
  dependencies) — any genuine MQTT device can connect to it exactly as it
  would to Mosquitto or HiveMQ.
- **Real database** (SQLite via Node's built-in `node:sqlite`) — every
  reading, alert, and report is computed from persisted, queryable data,
  not hardcoded values.
- **Real-time push** (hand-rolled WebSocket server, RFC 6455) — the
  dashboard updates live as telemetry arrives, no polling.
- **Real authentication** (scrypt password hashing, server-side session
  tokens with expiry) — not a fake login screen.
- **Real rule engine** — SLA breach detection, fuel theft detection,
  low-fuel/smoke/equipment alerts, and predictive-maintenance trend
  analysis are all computed from actual historical data, not labels.
- **Real camera detection** — the CCTV module uses your phone's actual
  camera and runs genuine on-device motion detection; walking in front of
  it fires a real alert through the same pipeline as every other event.

**Zero external npm/pip dependencies are required to run this project.**
That was a deliberate engineering choice — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#why-zero-dependencies) for
why, and for the documented upgrade path to Express/Postgres/React/Mosquitto
for a real production deployment.

## Quick start

Requires **Node.js 22.5+** (for built-in `node:sqlite`). No `npm install`
needed — the backend has zero runtime dependencies.

```bash
cd backend
npm start
# or: node --experimental-sqlite src/server.js
```

Then open **http://localhost:3000** in your browser.

- Demo login: `admin@towerplatform.demo` / `ChangeMe123!` (pre-filled on
  the login screen; **change this before any real deployment** — see
  `docs/DEPLOYMENT.md`)
- A fleet simulator starts automatically, publishing realistic live
  telemetry for 4 demo towers over MQTT into the same pipeline real
  hardware would use.
- Open **http://localhost:3000/camera-node** on your phone (same WiFi
  network as your laptop, or via a tunnel — see below) to turn it into a
  live CCTV node with real on-device motion detection.

To try it from a phone on the same network, replace `localhost` with your
laptop's LAN IP, e.g. `http://192.168.1.23:3000/camera-node`.

## Project structure

```
tower-platform/
├── backend/                  # Node.js API + MQTT broker + rule engines (zero deps)
│   ├── src/
│   │   ├── server.js         # entry point — wires everything together
│   │   ├── db/                # SQLite schema, connection, seed data
│   │   ├── mqtt/               # hand-rolled MQTT broker, client, ingest bridge
│   │   ├── ws/                 # hand-rolled WebSocket server
│   │   ├── http/                # router + REST route modules
│   │   ├── auth/                 # authentication
│   │   ├── engine/                # rule engine, SLA engine, predictive maintenance
│   │   └── simulators/             # fleet telemetry simulator
│   └── tests/                 # automated tests (node:test, zero deps)
├── frontend/                  # Vanilla JS/CSS SPA (no build step required)
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js, ws.js, charts.js, app.js
│       └── pages/              # dashboard, site detail, alerts, tenancy, reports, login
├── hardware-simulation/
│   ├── wokwi/                 # real ESP32 firmware + circuit diagram for Wokwi
│   └── camera-node/            # phone-camera CCTV page (getUserMedia + motion detection)
└── docs/                      # architecture, API, database, deployment, testing docs
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, data flow, and design rationale
- [`docs/API.md`](docs/API.md) — REST API and MQTT topic reference
- [`docs/DATABASE.md`](docs/DATABASE.md) — schema and ER description
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — how to deploy this for real
- [`docs/TESTING.md`](docs/TESTING.md) — how to run and extend the test suite
- [`docs/HARDWARE_SIMULATION.md`](docs/HARDWARE_SIMULATION.md) — what's simulated, why, and the real-hardware replacement path
- [`backend/README.md`](backend/README.md), [`frontend/README.md`](frontend/README.md), [`hardware-simulation/README.md`](hardware-simulation/README.md) — module-level detail

## Feature coverage

See [`docs/API.md`](docs/API.md) for the full endpoint list. Summary of
what's implemented and functional, mapped to the original brief:

| Category | Status |
|---|---|
| Infrastructure monitoring (status, uptime, SLA dashboards) | ✅ Full |
| Power monitoring (grid/solar/generator, auto-switching, utilization reports) | ✅ Full |
| Fuel & generator intelligence (level, consumption, runtime, low-fuel & theft alerts) | ✅ Full |
| Security monitoring (real camera CCTV, motion/intrusion detection, alarm lifecycle) | ✅ Full |
| Environmental monitoring (temperature, smoke, door, motion, equipment health) | ✅ Full |
| Commercial intelligence (tenancy ratio, occupancy, revenue opportunity) | ✅ Full |
| Reporting & analytics (executive dashboard, SLA reports, CSV export, predictive maintenance) | ✅ Full |

## License

MIT — built as a hackathon prototype / portfolio project.
