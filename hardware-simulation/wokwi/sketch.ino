/*
 * Smart Tower Monitoring Platform — Wokwi hardware simulation node
 * ------------------------------------------------------------------
 * Runs on a simulated ESP32 in Wokwi (https://wokwi.com), using REAL
 * firmware (this file) and REAL WiFi + MQTT — not a mockup. Wokwi's
 * simulated ESP32 has a genuine WiFi stack, so this sketch can connect
 * to any real MQTT broker reachable from the internet.
 *
 * IMPORTANT — Wokwi cannot reach 'localhost' on your laptop:
 * The broker embedded in this project's backend (backend/src/mqtt/broker.js)
 * only listens on your machine. Wokwi's cloud simulator cannot reach it.
 * To use THIS sketch against the real project, either:
 *   (a) Deploy the backend somewhere with a public IP/domain and point
 *       MQTT_HOST below at it, with the broker port exposed, OR
 *   (b) Point this sketch at a free public broker (e.g. HiveMQ Cloud,
 *       test.mosquitto.org) and adapt backend/src/mqtt/ingest.js to also
 *       connect outward to that broker instead of only running its own.
 * This limitation and both fixes are documented in
 * docs/HARDWARE_SIMULATION.md.
 *
 * Sensors wired (see diagram.json):
 *   DHT22            -> cabinet temperature
 *   PIR motion       -> motion detection
 *   Potentiometer    -> stand-in for a fuel-level sender unit (0-100%)
 *   Slide switch     -> door open/closed sensor
 *   LED              -> generator-on indicator (driven by firmware logic)
 *
 * Library dependencies (declared in libraries.txt for Wokwi):
 *   DHT sensor library (Adafruit), PubSubClient (Nick O'Leary)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

// ---- Configuration ---------------------------------------------------
const char* WIFI_SSID = "Wokwi-GUEST";   // Wokwi's built-in simulated WiFi network
const char* WIFI_PASS = "";
const char* MQTT_HOST = "test.mosquitto.org";  // swap for your deployed broker — see note above
const int   MQTT_PORT = 1883;
const char* SITE_ID   = "site-wokwi-01";

#define DHT_PIN 4
#define PIR_PIN 5
#define FUEL_PIN 34
#define DOOR_PIN 18
#define GEN_LED_PIN 19

DHT dht(DHT_PIN, DHT22);
WiFiClient espClient;
PubSubClient mqtt(espClient);

unsigned long lastPublish = 0;
const unsigned long PUBLISH_INTERVAL_MS = 5000;
bool generatorOn = false;
float fuelPct = 70.0;

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
}

void connectMqtt() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  while (!mqtt.connected()) {
    Serial.print("Connecting to MQTT broker...");
    String clientId = "wokwi-" + String(SITE_ID);
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc="); Serial.print(mqtt.state()); Serial.println(" retrying in 2s");
      delay(2000);
    }
  }
}

void publishJson(const char* channel, const String& json) {
  String topic = "sites/" + String(SITE_ID) + "/" + channel;
  mqtt.publish(topic.c_str(), json.c_str());
  Serial.println(topic + " -> " + json);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  pinMode(DOOR_PIN, INPUT_PULLUP);
  pinMode(GEN_LED_PIN, OUTPUT);
  dht.begin();
  connectWiFi();
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  unsigned long now = millis();
  if (now - lastPublish < PUBLISH_INTERVAL_MS) return;
  lastPublish = now;

  // --- Read sensors ---
  float tempC = dht.readTemperature();
  bool motion = digitalRead(PIR_PIN) == HIGH;
  bool doorOpen = digitalRead(DOOR_PIN) == LOW; // pulled up, LOW = closed circuit = open door in this wiring
  int fuelRaw = analogRead(FUEL_PIN); // 0-4095 on ESP32 ADC
  fuelPct = (fuelRaw / 4095.0) * 100.0;

  // --- Simple on-device logic: generator kicks in below 20% "grid simulated failure" chance ---
  generatorOn = (fuelPct > 5) && (random(0, 100) < 10); // occasionally simulate generator engaging
  digitalWrite(GEN_LED_PIN, generatorOn ? HIGH : LOW);

  // --- Publish telemetry using the SAME topic/payload schema as the fleet simulator ---
  publishJson("heartbeat", "{\"ts\":" + String(now) + "}");

  publishJson("env", "{\"temperature_c\":" + String(isnan(tempC) ? 25.0 : tempC, 1) +
                      ",\"smoke_detected\":false" +
                      ",\"door_open\":" + String(doorOpen ? "true" : "false") +
                      ",\"motion_detected\":" + String(motion ? "true" : "false") + "}");

  publishJson("fuel", "{\"level_pct\":" + String(fuelPct, 1) +
                       ",\"generator_on\":" + String(generatorOn ? "true" : "false") + "}");

  publishJson("power", "{\"source\":\"generator\",\"active\":" + String(generatorOn ? "true" : "false") +
                        ",\"voltage\":" + String(generatorOn ? 220 : 0) +
                        ",\"output_watts\":" + String(generatorOn ? 750 : 0) + "}");

  if (motion) {
    publishJson("security", "{\"event_type\":\"motion\",\"source\":\"pir\",\"confidence\":0.9}");
  }
}
