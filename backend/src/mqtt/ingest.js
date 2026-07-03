'use strict';
/**
 * Ingest service — the bridge between the device/simulator world (MQTT)
 * and the application world (SQLite + WebSocket). Every device (real
 * Wokwi ESP32, phone camera node, or the fleet simulator) publishes to
 * the same topic scheme; this is the single place that consumes it.
 *
 * Topic scheme (documented in docs/API.md):
 *   sites/{siteId}/heartbeat        { }
 *   sites/{siteId}/power            { source, active, voltage, output_watts }
 *   sites/{siteId}/fuel             { level_pct, generator_on }
 *   sites/{siteId}/generator        { event: 'start' | 'stop' }
 *   sites/{siteId}/env              { temperature_c, smoke_detected, door_open, motion_detected }
 *   sites/{siteId}/security         { event_type, source, confidence }
 */

const db = require('../db');
const ruleEngine = require('../engine/ruleEngine');

function startIngest(mqttClient, wsHub) {
  mqttClient.subscribe('sites/+/heartbeat');
  mqttClient.subscribe('sites/+/power');
  mqttClient.subscribe('sites/+/fuel');
  mqttClient.subscribe('sites/+/generator');
  mqttClient.subscribe('sites/+/env');
  mqttClient.subscribe('sites/+/security');

  mqttClient.on('message', (topic, messageBuf) => {
    const parts = topic.split('/');
    const siteId = parts[1];
    const channel = parts[2];
    let payload;
    try { payload = JSON.parse(messageBuf.toString('utf8')); } catch { return; }

    try {
      switch (channel) {
        case 'heartbeat':
          db.run('UPDATE sites SET last_heartbeat = datetime(\'now\') WHERE id = ?', [siteId]);
          if (db.get('SELECT status FROM sites WHERE id = ?', [siteId])?.status !== 'online') {
            db.run('UPDATE sites SET status = \'online\' WHERE id = ?', [siteId]);
            db.run('INSERT INTO status_log (site_id, status) VALUES (?, \'online\')', [siteId]);
          }
          wsHub.broadcast({ channel: 'heartbeat', siteId });
          break;

        case 'power': {
          db.run(
            'INSERT INTO power_readings (site_id, source, active, voltage, output_watts) VALUES (?, ?, ?, ?, ?)',
            [siteId, payload.source, payload.active ? 1 : 0, payload.voltage ?? null, payload.output_watts ?? null]
          );
          // Detect a source switch: was a different source active last time?
          const prevActive = db.get(
            `SELECT source FROM power_readings WHERE site_id = ? AND active = 1 AND source != ? ORDER BY ts DESC LIMIT 1`,
            [siteId, payload.source]
          );
          if (payload.active && prevActive && prevActive.source !== payload.source) {
            db.run(
              'INSERT INTO power_switch_events (site_id, from_source, to_source, reason) VALUES (?, ?, ?, ?)',
              [siteId, prevActive.source, payload.source, 'automatic']
            );
          }
          wsHub.broadcast({ channel: 'power', siteId, payload });
          break;
        }

        case 'fuel': {
          db.run(
            'INSERT INTO fuel_readings (site_id, level_pct, generator_on) VALUES (?, ?, ?)',
            [siteId, payload.level_pct, payload.generator_on ? 1 : 0]
          );
          const alerts = ruleEngine.evaluateFuel(siteId, payload);
          for (const a of alerts) wsHub.broadcast({ channel: 'alert', siteId, alert: a });
          wsHub.broadcast({ channel: 'fuel', siteId, payload });
          break;
        }

        case 'generator':
          db.run('INSERT INTO generator_runtime_log (site_id, event) VALUES (?, ?)', [siteId, payload.event]);
          wsHub.broadcast({ channel: 'generator', siteId, payload });
          break;

        case 'env': {
          db.run(
            'INSERT INTO env_readings (site_id, temperature_c, smoke_detected, door_open, motion_detected) VALUES (?, ?, ?, ?, ?)',
            [siteId, payload.temperature_c ?? null, payload.smoke_detected ? 1 : 0, payload.door_open ? 1 : 0, payload.motion_detected ? 1 : 0]
          );
          const alerts = ruleEngine.evaluateEnv(siteId, payload);
          for (const a of alerts) wsHub.broadcast({ channel: 'alert', siteId, alert: a });
          wsHub.broadcast({ channel: 'env', siteId, payload });
          break;
        }

        case 'security': {
          db.run(
            'INSERT INTO security_events (site_id, event_type, source, confidence) VALUES (?, ?, ?, ?)',
            [siteId, payload.event_type, payload.source, payload.confidence ?? null]
          );
          const alerts = ruleEngine.evaluateSecurity(siteId, payload);
          for (const a of alerts) wsHub.broadcast({ channel: 'alert', siteId, alert: a });
          wsHub.broadcast({ channel: 'security', siteId, payload });
          break;
        }
      }
    } catch (e) {
      console.error(`[ingest] error processing ${topic}:`, e.message);
    }
  });
}

module.exports = { startIngest };
