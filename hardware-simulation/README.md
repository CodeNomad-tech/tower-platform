# Hardware simulation

See `../docs/HARDWARE_SIMULATION.md` for what is simulated, why, and how to
replace it.

* `wokwi/`: ESP32 firmware (`sketch.ino`) and circuit (`diagram.json`) for
  wokwi.com. It publishes the TowerIQ MQTT contract as site `WOKWI-01`. Create
  that site first (admin: `POST /api/sites`). Wokwi needs a broker reachable
  from the internet.
* `camera-node/`: turns a phone into a CCTV node with on-device motion
  detection. An admin creates a pairing link (Settings → Pair a phone camera
  node). Open it on the phone over HTTPS (tunnel) or on `localhost`.
