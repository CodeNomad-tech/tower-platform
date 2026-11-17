# Deployment

## Demo / local (what ships)

```bash
cd backend
npm start            # node --experimental-sqlite src/server.js → http://localhost:3000
npm run demo:reset   # delete the demo DB; next start regenerates 30 days of simulated history
```

Requires **Node.js 22.5+** (tested on Node 26). No `npm install` and no
internet access needed.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Console, API, WebSocket |
| `MQTT_PORT` | 1883 | Embedded broker |
| `DB_PATH` | `backend/data/toweriq.db` | SQLite file |
| `DEMO_MODE` | `true` | Seed the simulated fleet + demo users + scenario controls |
| `RUN_SIMULATOR` | = `DEMO_MODE` | Drive simulated sites in real time |
| `HISTORY_DAYS` | 30 | Days of simulated history generated on first start |
| `SIM_TICK_MS` | 10000 | Simulated telemetry interval |
| `DEMO_ADMIN_PASSWORD` | `ChangeMe123!` | Password for the three demo accounts |

## Phone camera node across devices

Browsers only allow camera access on HTTPS or `localhost`. For a phone on
venue Wi-Fi, expose the server through an HTTPS tunnel (for example
`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`). Then,
as admin: **Settings → Pair a phone camera node**, and open the generated
`/camera-node/?key=…` link on the phone. Without venue internet, use a laptop
browser at `http://localhost:3000/camera-node/?key=…` instead.

## Production checklist

1. `DEMO_MODE=false`. Nothing is seeded and no simulator runs. Create the
   first admin with `npm run create-admin -- you@example.com`.
2. Terminate **TLS** at a reverse proxy (Caddy or nginx) in front of port 3000,
   forwarding WebSocket upgrades on `/ws`.
3. Replace the embedded broker with a managed or self-hosted broker with TLS
   and per-device credentials. Point the ingest client and devices at it.
   Topics are unchanged.
4. Enter real sites (`POST /api/sites`) and their **asset register**
   (`PUT /api/sites/:id/assets`). Forecast quality depends on accurate tank
   size, battery and solar capacity, nameplate burn rate and refuel lead time.
5. Replace placeholder **business assumptions** in Settings: SLA credit
   terms, capex unit costs, current ERB diesel price.
6. Review alarm thresholds in `engine/ruleEngine.js` (`THRESHOLDS`) against
   operating policy.
7. Back up the database (SQLite: `.backup` or file copy while stopped).
   Move to PostgreSQL/TimescaleDB beyond a single server (DATABASE.md).
8. Run it as a service (systemd), e.g. `Restart=on-failure`,
   `Environment=DEMO_MODE=false`, under a non-root user.
