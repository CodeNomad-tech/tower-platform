# Backend

Node.js API server, embedded MQTT broker, rule engines, and fleet
simulator. **Zero runtime dependencies** — see
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#why-zero-dependencies).

## Run

```bash
npm start        # production-style start
npm run dev       # auto-restart on file changes (node --watch)
npm test          # run the test suite
npm run seed       # manually (re-)run the demo data seed
```

Requires Node.js 22.5+.

## Directory guide

| Path | Purpose |
|---|---|
| `src/server.js` | Entry point — wires HTTP, MQTT broker, WebSocket hub, ingest, and background jobs together |
| `src/db/` | SQLite schema (`schema.sql`), connection wrapper (`index.js`), demo data seed (`seed.js`) |
| `src/mqtt/` | Hand-rolled MQTT broker (`broker.js`) and client (`client.js`); telemetry ingest bridge (`ingest.js`) |
| `src/ws/` | Hand-rolled WebSocket server (`hub.js`) |
| `src/http/` | Minimal router (`router.js`) and REST route modules (`routes/`) |
| `src/auth/` | Registration, login, session middleware |
| `src/engine/` | Rule engine (alerts), SLA engine (uptime/breach calc), predictive maintenance engine (trend analysis) |
| `src/simulators/` | Fleet telemetry simulator |
| `tests/` | `node:test`-based unit and integration tests |

See [`../docs/API.md`](../docs/API.md) for the full endpoint and MQTT
topic reference, and [`../docs/DATABASE.md`](../docs/DATABASE.md) for the
schema.
