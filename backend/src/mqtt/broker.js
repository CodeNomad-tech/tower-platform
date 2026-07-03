'use strict';
/**
 * Minimal MQTT 3.1.1 broker (QoS 0 only) implemented on node:net.
 *
 * Why hand-rolled: this project intentionally ships with zero external
 * dependencies so it runs anywhere with just `node server.js` — no
 * `npm install`, no internet required. The wire protocol implemented here
 * is genuine MQTT (fixed header, remaining-length encoding, CONNECT/
 * CONNACK/SUBSCRIBE/SUBACK/PUBLISH/PINGREQ/PINGRESP/DISCONNECT), so any
 * real MQTT device (e.g. an ESP32 running PubSubClient in Wokwi, or a
 * real Arduino in the field later) can connect to it exactly as it would
 * to Mosquitto, HiveMQ, or EMQX.
 *
 * Production upgrade path: point devices at a managed broker (HiveMQ
 * Cloud / EMQX Serverless free tier, or self-hosted Mosquitto) instead of
 * this embedded one, and swap this module for an `mqtt.js` client — no
 * change needed to topic names or payload shapes. See docs/DEPLOYMENT.md.
 *
 * Supported packet types: CONNECT(1), PUBLISH(3), SUBSCRIBE(8), PINGREQ(12),
 * DISCONNECT(14). QoS 0 only (sufficient for telemetry streaming).
 */

const net = require('node:net');
const EventEmitter = require('node:events');

const TYPE = {
  CONNECT: 1, CONNACK: 2, PUBLISH: 3, SUBSCRIBE: 8, SUBACK: 9,
  PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14,
};

function encodeRemainingLength(length) {
  const bytes = [];
  do {
    let byte = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) byte |= 0x80;
    bytes.push(byte);
  } while (length > 0);
  return Buffer.from(bytes);
}

function decodeRemainingLength(buf, offset) {
  let multiplier = 1, value = 0, i = offset;
  let byte;
  do {
    if (i >= buf.length) return null; // incomplete
    byte = buf[i++];
    value += (byte & 127) * multiplier;
    multiplier *= 128;
  } while ((byte & 128) !== 0);
  return { value, nextOffset: i };
}

function topicMatches(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (f[i] === '+') { if (i >= t.length) return false; continue; }
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

class MqttBroker extends EventEmitter {
  constructor({ port = 1883 } = {}) {
    super();
    this.port = port;
    this.clients = new Map(); // socket -> { subscriptions: Set<string>, buffer: Buffer }
    this.server = net.createServer((socket) => this._handleConnection(socket));
  }

  listen() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => resolve(this.port));
    });
  }

  close() {
    return new Promise((resolve) => this.server.close(resolve));
  }

  _handleConnection(socket) {
    const client = { subscriptions: new Set(), buffer: Buffer.alloc(0), id: null };
    this.clients.set(socket, client);

    socket.on('data', (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      this._processBuffer(socket, client);
    });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  _processBuffer(socket, client) {
    while (client.buffer.length >= 2) {
      const firstByte = client.buffer[0];
      const type = firstByte >> 4;
      const lenInfo = decodeRemainingLength(client.buffer, 1);
      if (!lenInfo) return; // wait for more data
      const totalLen = 1 + (lenInfo.nextOffset - 1) + lenInfo.value;
      if (client.buffer.length < totalLen) return; // wait for more data

      const packet = client.buffer.subarray(lenInfo.nextOffset, totalLen);
      client.buffer = client.buffer.subarray(totalLen);
      this._handlePacket(socket, client, type, packet);
    }
  }

  _handlePacket(socket, client, type, payload) {
    switch (type) {
      case TYPE.CONNECT: {
        // Skip protocol name/level/flags/keepalive, just grab client id for logging
        let offset = 0;
        const protoNameLen = payload.readUInt16BE(offset); offset += 2 + protoNameLen;
        offset += 1; // protocol level
        offset += 1; // connect flags
        offset += 2; // keepalive
        const clientIdLen = payload.readUInt16BE(offset); offset += 2;
        client.id = payload.subarray(offset, offset + clientIdLen).toString('utf8');
        // CONNACK: session-present=0, return-code=0 (accepted)
        socket.write(Buffer.from([TYPE.CONNACK << 4, 2, 0, 0]));
        this.emit('client-connected', client.id);
        break;
      }
      case TYPE.SUBSCRIBE: {
        let offset = 0;
        const packetId = payload.readUInt16BE(offset); offset += 2;
        const granted = [];
        while (offset < payload.length) {
          const topicLen = payload.readUInt16BE(offset); offset += 2;
          const topic = payload.subarray(offset, offset + topicLen).toString('utf8'); offset += topicLen;
          const qos = payload[offset]; offset += 1;
          client.subscriptions.add(topic);
          granted.push(qos);
        }
        const body = Buffer.concat([
          Buffer.from([packetId >> 8, packetId & 0xff]),
          Buffer.from(granted),
        ]);
        socket.write(Buffer.concat([
          Buffer.from([TYPE.SUBACK << 4]), encodeRemainingLength(body.length), body,
        ]));
        break;
      }
      case TYPE.PUBLISH: {
        let offset = 0;
        const topicLen = payload.readUInt16BE(offset); offset += 2;
        const topic = payload.subarray(offset, offset + topicLen).toString('utf8'); offset += topicLen;
        const message = payload.subarray(offset);
        this._distribute(topic, message);
        this.emit('message', topic, message);
        break;
      }
      case TYPE.PINGREQ: {
        socket.write(Buffer.from([TYPE.PINGRESP << 4, 0]));
        break;
      }
      case TYPE.DISCONNECT: {
        socket.end();
        break;
      }
      default:
        break; // ignore unsupported types (QoS1/2 acks etc. — not used in this project)
    }
  }

  _distribute(topic, message) {
    const topicBuf = Buffer.from(topic, 'utf8');
    const header = Buffer.concat([
      Buffer.from([topicBuf.length >> 8, topicBuf.length & 0xff]),
      topicBuf,
    ]);
    const body = Buffer.concat([header, message]);
    const packet = Buffer.concat([
      Buffer.from([TYPE.PUBLISH << 4]), encodeRemainingLength(body.length), body,
    ]);
    for (const [socket, client] of this.clients) {
      for (const filter of client.subscriptions) {
        if (topicMatches(filter, topic)) {
          socket.write(packet);
          break;
        }
      }
    }
  }
}

module.exports = { MqttBroker, TYPE, encodeRemainingLength, decodeRemainingLength, topicMatches };
