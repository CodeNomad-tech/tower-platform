# Hardware Simulation: What Is Simulated, Why, and How to Replace It

TowerIQ was built without tower hardware. Every simulated component speaks
the **same protocol and data contract** a real device uses (API.md, "MQTT
device contract"), so moving to hardware changes the data source, not the
platform. All simulated data is labelled as such in the API (`/api/meta`)
and the console.

## 1. Tower telemetry (power, battery, fuel, environment)

**Implemented instead**
* **Fleet simulator** (`backend/src/simulators/fleetSimulator.js`): 12 fictional
  sites in real Zambian towns, each driven in real time by the site power model
  (`engine/powerModel.js`) under a load-shedding profile modelled on the shape
  of 2024 ZESCO schedules. It publishes MQTT exactly like a remote-monitoring
  unit and resumes from the last persisted state.
* **Simulated history** (`backend/src/db/history.js`): 30 days generated with the
  same model, including documented anomalies (an abrupt theft at Ndola, nightly
  siphoning at Kitwe, generator wear at Chipata, an intrusion at Solwezi). See
  `db/catalog.js`.
* **Wokwi ESP32 firmware** (`hardware-simulation/wokwi/sketch.ino`): real firmware
  with WiFi + PubSubClient publishing the same topics for site `WOKWI-01`
  (create that site first via the API).

**Why:** no hardware budget, and a demo needs months of realistic operations to
make SLA, utilisation, forecasting and reconciliation meaningful.

**How to replace:** point real RMS controllers (or an adapter for their native
protocol; see the `infratel/tower/*` adapter in `mqtt/ingest.js`) at the broker,
register the site and its assets, and set `DEMO_MODE=false`. No backend or
frontend changes are needed.

## 2. MQTT broker

**Implemented instead:** a hand-rolled MQTT 3.1.1 broker (QoS 0) embedded in the
server. It is real wire protocol, so ESP32 PubSubClient or mqtt.js connect to
it as they would to Mosquitto. Malformed packets disconnect only the
offending client.

**Limit:** no authentication or TLS. **Replace with** EMQX, Mosquitto or HiveMQ
with TLS and per-device credentials; only host and port change.

## 3. CCTV

**Implemented instead:** `hardware-simulation/camera-node/`, a phone browser
page using the real camera with on-device frame differencing. It sends events
only, never video. It must be paired with an admin-issued device key, and
sustained motion (3 detections in 30 s) escalates from `motion` to
`intrusion`.

**Replace with** IP cameras or an NVR that emit events by MQTT or webhook, or
permanently mounted phones. Optionally add on-device person detection
(TensorFlow.js COCO-SSD) to cut false alarms from animals and vegetation.

## 4. Demo users and assumptions

Three demo accounts (`admin|operator|viewer@toweriq.demo`) exist only in demo
mode. Business assumptions (diesel price, SLA credit multiplier, capex) are
editable placeholders. Replace them before using any Kwacha figure for
decisions.
