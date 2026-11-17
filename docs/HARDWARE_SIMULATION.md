# Hardware Simulation — What's Simulated, Why, and How to Replace It

This project was built with zero budget for physical hardware. Rather than
mock features out, every simulated component was built to speak the exact
same protocol and data contract a real device would use, so swapping in
real hardware later requires no backend or frontend changes — only a
different data source.

This document follows the format: **(1) what was implemented instead,
(2) what's different, (3) why the change was necessary, (4) how to
replace it with the real thing.**

---

## 1. Tower hardware (sensors, power, fuel gauge)

**Implemented instead:** Two complementary simulated sources:
- A real ESP32 firmware sketch (`hardware-simulation/wokwi/sketch.ino`)
  running in [Wokwi](https://wokwi.com), a browser-based circuit
  simulator with a genuinely working simulated WiFi stack and real MQTT
  publishing.
- A fleet simulator (`backend/src/simulators/fleetSimulator.js`) modeling
  an entire network of towers with physically-plausible telemetry
  (diurnal solar curve, proportional fuel drain, realistic power-source
  switching priority).

**What's different:** No physical sensors exist; sensor values come from
Wokwi's simulated components (DHT22, PIR, potentiometer standing in for
a fuel sender unit) or from the fleet simulator's model, rather than real
transducers reading real physical quantities.

**Why necessary:** No budget for tower hardware, and a hackathon/prototype
timeline doesn't allow procurement and field installation.

**Replacement path:** Both simulated sources publish to the exact same
MQTT topics and JSON payload shapes documented in `docs/API.md`
(`sites/{siteId}/power`, `/fuel`, `/env`, etc.). To go to real hardware:
1. Flash the logic from `sketch.ino` (or equivalent) onto a real ESP32
   wired to real sensors (a real fuel-level sender instead of a
   potentiometer, a real DHT22, etc.).
2. Point `MQTT_HOST` in the firmware at your deployed broker.
3. Turn off the fleet simulator for that site (or all sites) by setting
   `RUN_SIMULATOR=false` in the backend's environment.
No backend or frontend code changes are required — the ingest pipeline,
rule engine, and dashboard already consume this exact schema.

---

## 2. MQTT broker

**Implemented instead:** A hand-rolled MQTT 3.1.1 broker (QoS 0) on
`node:net`, embedded in the backend process (`backend/src/mqtt/broker.js`).

**What's different:** A production deployment would typically use a
dedicated, battle-tested broker (Mosquitto, HiveMQ, EMQX) rather than an
embedded custom implementation.

**Why necessary:** The development environment used to build this project
had no internet access for `npm install`, so a package like `aedes` or
`mosquitto` couldn't be installed. A hand-rolled broker was built instead
so the whole pipeline could be built and verified running, rather than
delivered as unverified code. It implements the genuine wire protocol
(CONNECT/CONNACK, SUBSCRIBE/SUBACK, PUBLISH, PINGREQ/PINGRESP,
DISCONNECT), so it is not a mock — a real MQTT client library on a real
device connects to it correctly.

**Replacement path:** Point every device (and the backend's own
`MqttClient` instances) at a managed broker instead — HiveMQ Cloud or
EMQX Serverless both have free tiers suitable for a prototype's traffic
volume, or self-host Mosquitto. Only the `host`/`port` in each client's
configuration changes; topic names and payloads are unaffected.

---

## 3. CCTV / security camera

**Implemented instead:** A standalone web page
(`hardware-simulation/camera-node/index.html`) that uses a phone's real
camera via `getUserMedia()` and runs genuine on-device motion detection
(canvas-based frame differencing, zero dependencies) directly in the
browser — no video is streamed to a server for processing.

**What's different:** A production deployment would use dedicated,
permanently-mounted IP cameras feeding an NVR (network video recorder)
with dedicated analytics hardware, rather than a phone browser tab.

**Why necessary:** No budget for CCTV hardware. Phones already have
cameras, networking, and enough compute to run real-time motion
detection — using them is not a placeholder, it's a legitimate edge-
inference architecture (detect on-device, only publish the *event*, not
raw video, which is also good bandwidth practice for a real deployment).

**What's genuinely real here:** the camera feed is a real live video
feed (not a stock image or pre-recorded clip); the motion detection
algorithm genuinely analyzes live frames pixel-by-pixel; walking in front
of the phone produces a real, verifiable alert through the exact same
pipeline as every other event type (verified end-to-end during
development — see `docs/TESTING.md`).

**Optional enhancement path (higher-confidence detection):** The page is
structured to allow adding [TensorFlow.js](https://www.tensorflow.org/js)
with a COCO-SSD model (loaded from a CDN) for actual person detection
instead of generic motion — this distinguishes "a person walked by" from
"a leaf blew past." This was intentionally left as an optional
enhancement rather than a hard dependency, so the camera node works fully
offline (frame-differencing motion detection requires no internet at
all after the page itself loads); the comment block at the top of
`camera-node/index.html` explains where to add it.

**Replacement path to real CCTV hardware:** Deploy real IP cameras with
an NVR that supports MQTT or webhook output (many commercial NVRs do), or
keep the phone-node pattern but mount phones permanently with a charging
solution — the backend ingest pipeline doesn't need to change either way,
since it already consumes `security` events by `event_type` and
`source`, regardless of what physical device produced them.

---

## 4. Auto-provisioned demo data (sites, tenants, admin user)

**Implemented instead:** `backend/src/db/seed.js` creates 4 demo sites,
9 sample tenants, and one admin user (`admin@towerplatform.demo`) on
first boot if the database is empty.

**What's different:** obviously, a real deployment has real site/tenant
data entered by operators, not pre-seeded demo data.

**Why necessary:** so the dashboard is immediately populated for a
hackathon demo rather than showing an empty state on first load.

**Replacement path:** Set `RUN_SIMULATOR=false`, delete the demo admin
account, and use the `POST /api/sites` and `POST /api/tenancy/:siteId/tenants`
endpoints (or a future admin UI) to enter real data. See
`docs/DEPLOYMENT.md` for the full pre-production checklist.
