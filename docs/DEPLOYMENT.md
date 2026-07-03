# Deployment Guide

## Local / demo deployment (what this project ships as)

```bash
cd backend
npm start          # node --experimental-sqlite src/server.js
```

Requires Node.js 22.5+ (for built-in `node:sqlite`). No `npm install`
step — zero runtime dependencies. Serves both the API and the frontend
from a single process on `PORT` (default 3000).

Environment variables (see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `MQTT_PORT` | `1883` | Embedded MQTT broker port |
| `DB_PATH` | `./data/tower_platform.db` | SQLite file location |
| `RUN_SIMULATOR` | `true` | Set to `false` once real devices are feeding the platform |

## Demoing on a physical phone (camera node)

The phone and laptop must be able to reach each other:
- **Same WiFi network:** use your laptop's LAN IP, e.g.
  `http://192.168.1.23:3000/camera-node`. Find your LAN IP with
  `ipconfig` (Windows) or `ifconfig`/`ip addr` (Mac/Linux).
- **Different networks / unreliable venue WiFi:** use a tunnel, e.g.
  `ngrok http 3000`, and open the resulting HTTPS URL's `/camera-node`
  path on the phone. Note: `getUserMedia()` requires HTTPS (or
  `localhost`) — a plain `http://` LAN IP will NOT be able to access the
  camera on most modern phone browsers. Use ngrok (which provides HTTPS)
  for phone camera testing unless you set up local TLS certificates.

## Pre-production checklist

Before treating this as anything beyond a demo/prototype:

1. **Remove the demo admin account.** `admin@towerplatform.demo` /
   `ChangeMe123!` is created automatically by `backend/src/db/seed.js` —
   delete this user (`DELETE FROM users WHERE email = '...'`) and require
   real registered accounts.
2. **Set `RUN_SIMULATOR=false`** so the fleet simulator doesn't publish
   fake telemetry alongside real device data.
3. **Move to a real MQTT broker.** See `docs/HARDWARE_SIMULATION.md`
   §2 — point real devices and the backend's internal `MqttClient`
   instances at a managed broker or self-hosted Mosquitto instead of the
   embedded one, and run the broker on infrastructure with proper
   network security (TLS, client certificates or username/password auth
   — the embedded broker in this project has none, by design, since it's
   meant to run on localhost during development).
4. **Migrate to PostgreSQL** for multi-instance deployments — see
   `docs/DATABASE.md`'s migration section. SQLite is fine for a single
   backend process but doesn't support concurrent writes from multiple
   server instances.
5. **Put the backend behind HTTPS** (a reverse proxy like Caddy or nginx,
   or a platform that terminates TLS for you) — required for
   `getUserMedia()` to work on the camera node in production, and for
   session tokens to be transmitted safely.
6. **Review alert thresholds** in `backend/src/engine/ruleEngine.js`
   (`THRESHOLDS` object) against real operational requirements — the
   defaults (20% low fuel, 15% drop in 10 minutes for theft detection,
   45°C high temperature, 3-minute offline timeout) were chosen for a
   readable demo pace, not validated against real tower operations.
7. **Add rate limiting and input validation hardening** to the HTTP
   router if exposing this beyond a trusted network — the current router
   validates request bodies at the route level but has no request-rate
   limiting.

## Running the fleet simulator against a subset of sites

By default, the simulator seeds and drives all 4 demo sites. To run a
mixed real/simulated fleet (e.g. 1 real Wokwi node + 3 simulated sites
for a demo), either:
- Remove the real site's ID from `DEMO_SITES` in `backend/src/db/seed.js`
  so the simulator doesn't also drive it, or
- Simply don't point a real device's `SITE_ID` at one the simulator
  already owns — whichever publishes last "wins" per reading, which is
  fine for a demo but should be tidied up for anything more serious.
