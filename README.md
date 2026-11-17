# TowerIQ

**Know which towers will go dark, before they do.**

TowerIQ is a tower monitoring and resilience-intelligence platform built for
the **INFRATEL–UNZA iHub Hackathon, Challenge 1: Smart Tower Monitoring &
Infrastructure Intelligence**.

Zambian towers go dark when load-shedding outlasts their battery, solar and
diesel. Monitoring that reports a tower *is* down is too late. TowerIQ learns
each tower's grid pattern and real fuel consumption, then forecasts blackout
risk. It produces:

* a **ranked do-this-next queue** with deadlines and Kwacha values
* a **costed redundancy plan** for any load-shedding scenario, which is the
  kind of plan ZICTA asked Infratel for in November 2025
* **fuel integrity**: every litre reconciled, with theft, siphoning and
  failing generators told apart

> ⚠️ The demo runs on a **simulated** 12-site fleet with 30 days of physically
> simulated history. It is not Infratel data, and it is labelled as simulated
> throughout.

## Quick start

```bash
cd backend
npm start                 # Node.js 22.5+; no npm install, no internet needed
# open http://localhost:3000   (admin@toweriq.demo / ChangeMe123!, pre-filled)
npm test                  # 36 tests
npm run demo:reset        # regenerate the simulated fleet
```

Demo accounts (same password): `admin@` (everything, incl. demo scenario
controls), `operator@` (alarms, deliveries), `viewer@` (read-only),
all `@toweriq.demo`.

## What's in the box

| Brief requirement | Where |
|---|---|
| Site status, real-time uptime, historical uptime, SLA dashboards | Overview, Sites, Site page, Reports |
| Grid / solar / generator (and battery) monitoring, automatic switching visibility, utilisation daily → yearly | Site page timeline, switch log, utilisation; Reports |
| Diesel level, consumption, runtime, low-fuel & theft alerts | Site page, Fuel Integrity, Alarms |
| CCTV integration, intrusion/motion, alarm management, unauthorised access | Phone camera node, Alarms (ack/resolve/notes, MTTA/MTTR) |
| Temperature, smoke, door, motion, equipment health | Site page, Alarms |
| Tenancy ratio, clients per site, utilisation, revenue opportunity | Commercial |
| Executive dashboards, NOC-compatible exports, automated SLA reports, predictive maintenance | Overview, Reports (CSV), predictive indicators |
| **Beyond the brief: Resilience Engine** (blackout runway, action queue, redundancy planner) | Overview, Site page, Resilience Planner |

## Documentation

| | |
|---|---|
| [docs/STRATEGY.md](docs/STRATEGY.md) | Problem, users, differentiator choice, roadmap |
| [docs/RESILIENCE_ENGINE.md](docs/RESILIENCE_ENGINE.md) | The signature innovation: method, validation, limits |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | 5-minute live demo with expected results |
| [docs/PITCH.md](docs/PITCH.md) | Presentation outline mapped to judging criteria |
| [docs/COMMERCIALISATION.md](docs/COMMERCIALISATION.md) | Customers, model, costs, competition, pilot plan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [API.md](docs/API.md) · [DATABASE.md](docs/DATABASE.md) | Technical reference |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [TESTING.md](docs/TESTING.md) · [HARDWARE_SIMULATION.md](docs/HARDWARE_SIMULATION.md) | Operations |
| [docs/AUDIT.md](docs/AUDIT.md) · [IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) | What was found, what changed, what remains |

## Structure

```
backend/   Node.js server: API, MQTT broker, WebSocket, engines, simulator (zero runtime deps)
frontend/  Vanilla JS console, no build step (served by the backend)
hardware-simulation/  Wokwi ESP32 firmware, phone camera node
docs/      Strategy, architecture, demo, pitch, commercialisation
```

## Honest status

Working prototype with automated tests and a hardened core. **Not yet
validated on real tower data**; forecast accuracy is what the proposed pilot
measures. See [IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) for limits
and roadmap.

License: MIT.
