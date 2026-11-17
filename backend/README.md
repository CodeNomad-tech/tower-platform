# TowerIQ backend

One Node.js process (22.5+), **zero runtime dependencies**: REST API, static
console, authenticated WebSocket, embedded MQTT broker, telemetry ingest, the
engines, and (in demo mode) the fleet simulator.

```bash
npm start            # serve on :3000 (MQTT :1883)
npm run dev          # restart on file changes
npm test             # 36 tests (node:test)
npm run demo:reset   # wipe demo DB; next start regenerates simulated history
npm run create-admin -- you@example.com   # production (DEMO_MODE=false)
```

| Path | Purpose |
|---|---|
| `src/server.js` | Wiring, static files (CSP), WebSocket auth, background jobs |
| `src/config.js`, `src/settings.js` | Runtime config (env) and editable business assumptions |
| `src/db/` | Schema, connection, demo catalog/seed, simulated-history generator |
| `src/engine/` | `powerModel` (digital twin), `gridModel`, `resilience`, `fuelIntegrity`, `predictiveEngine`, `ruleEngine`, `slaEngine` |
| `src/mqtt/`, `src/ws/` | Broker/client, ingest with validation; WebSocket hub |
| `src/http/`, `src/auth/` | Router + routes; sessions, roles, throttling, audit |
| `src/simulators/` | Real-time fleet simulator + demo scenario controls |
| `tests/` | Engine unit tests and API integration tests |

See `../docs/ARCHITECTURE.md` and `../docs/API.md`. Environment variables: `.env.example`.
