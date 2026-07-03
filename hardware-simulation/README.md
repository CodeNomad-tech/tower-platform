# Hardware Simulation

Everything in this folder stands in for physical hardware that wasn't
available for this build. See
[`../docs/HARDWARE_SIMULATION.md`](../docs/HARDWARE_SIMULATION.md) for
the full "what/why/replace" breakdown of each piece. Quick reference:

## `wokwi/`

Real ESP32 firmware (`sketch.ino`) and circuit diagram (`diagram.json`)
for [Wokwi](https://wokwi.com), a free browser-based circuit simulator.

**To run it:**
1. Go to https://wokwi.com/projects/new/esp32
2. Replace the default sketch with `sketch.ino`
3. Replace the default `diagram.json` with the one in this folder
4. Add the libraries listed in `libraries.txt` via Wokwi's Library Manager
5. Update `MQTT_HOST` in the sketch — Wokwi's simulated WiFi can reach
   the public internet but **not** `localhost` on your laptop, so you'll
   need either a deployed backend with a public address, or point it at
   a free public broker for a standalone demo. Full detail in the sketch's
   top comment block and in `docs/HARDWARE_SIMULATION.md`.
6. Click "Start simulation" — the sketch will connect to WiFi, connect to
   MQTT, and start publishing real sensor telemetry.

## `camera-node/`

A standalone HTML page turning any phone (or laptop) with a camera and a
browser into a live CCTV node with real on-device motion detection —
no app install, no server-side video processing.

**To run it:** start the backend (see the root `README.md`), then open
`http://<backend-host>:3000/camera-node` on a phone's browser. Requires
HTTPS (or `localhost`) for camera access per browser security rules — see
`docs/DEPLOYMENT.md` for tunneling options if demoing across devices on a
venue network.
