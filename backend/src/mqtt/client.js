'use strict';
/**
 * Minimal MQTT 3.1.1 client (QoS 0), companion to broker.js.
 * Used by the fleet simulator, the ingest service, and can equally be used
 * by a real device sketch ported to Node (or swapped for PubSubClient.h /
 * mqtt.js in production — same wire protocol).
 */

const net = require('node:net');
const EventEmitter = require('node:events');
const { TYPE, encodeRemainingLength, decodeRemainingLength } = require('./broker');

class MqttClient extends EventEmitter {
  constructor({ host = 'localhost', port = 1883, clientId }) {
    super();
    this.host = host;
    this.port = port;
    this.clientId = clientId || `client-${Math.random().toString(16).slice(2)}`;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this._sendConnect();
      });
      this.socket.on('data', (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this._processBuffer();
      });
      this.socket.on('error', reject);
      this._resolveConnect = resolve;
    });
  }

  _sendConnect() {
    const proto = Buffer.from('MQTT', 'utf8');
    const clientIdBuf = Buffer.from(this.clientId, 'utf8');
    const variableHeader = Buffer.concat([
      Buffer.from([0, proto.length]), proto,
      Buffer.from([4]),      // protocol level 4 = MQTT 3.1.1
      Buffer.from([2]),      // connect flags: clean session
      Buffer.from([0, 60]),  // keepalive 60s
    ]);
    const payload = Buffer.concat([Buffer.from([clientIdBuf.length >> 8, clientIdBuf.length & 0xff]), clientIdBuf]);
    const body = Buffer.concat([variableHeader, payload]);
    this.socket.write(Buffer.concat([Buffer.from([TYPE.CONNECT << 4]), encodeRemainingLength(body.length), body]));
  }

  subscribe(topic) {
    const topicBuf = Buffer.from(topic, 'utf8');
    const packetId = Math.floor(Math.random() * 65535);
    const body = Buffer.concat([
      Buffer.from([packetId >> 8, packetId & 0xff]),
      Buffer.from([topicBuf.length >> 8, topicBuf.length & 0xff]), topicBuf,
      Buffer.from([0]), // QoS 0
    ]);
    this.socket.write(Buffer.concat([Buffer.from([TYPE.SUBSCRIBE << 4 | 2]), encodeRemainingLength(body.length), body]));
  }

  publish(topic, message) {
    const topicBuf = Buffer.from(topic, 'utf8');
    const msgBuf = Buffer.isBuffer(message) ? message : Buffer.from(String(message), 'utf8');
    const body = Buffer.concat([
      Buffer.from([topicBuf.length >> 8, topicBuf.length & 0xff]), topicBuf, msgBuf,
    ]);
    this.socket.write(Buffer.concat([Buffer.from([TYPE.PUBLISH << 4]), encodeRemainingLength(body.length), body]));
  }

  end() {
    if (this.socket) {
      this.socket.write(Buffer.from([TYPE.DISCONNECT << 4, 0]));
      this.socket.end();
    }
  }

  _processBuffer() {
    while (this.buffer.length >= 2) {
      const type = this.buffer[0] >> 4;
      const lenInfo = decodeRemainingLength(this.buffer, 1);
      if (!lenInfo) return;
      const totalLen = lenInfo.nextOffset + lenInfo.value;
      if (this.buffer.length < totalLen) return;
      const payload = this.buffer.subarray(lenInfo.nextOffset, totalLen);
      this.buffer = this.buffer.subarray(totalLen);

      if (type === TYPE.CONNACK) {
        this.connected = true;
        this.emit('connect');
        if (this._resolveConnect) { this._resolveConnect(); this._resolveConnect = null; }
      } else if (type === TYPE.PUBLISH) {
        const topicLen = payload.readUInt16BE(0);
        const topic = payload.subarray(2, 2 + topicLen).toString('utf8');
        const message = payload.subarray(2 + topicLen);
        this.emit('message', topic, message);
      }
    }
  }
}

module.exports = { MqttClient };
