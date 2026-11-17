'use strict';
/**
 * Minimal WebSocket server (RFC 6455) built on node:http's 'upgrade' event.
 * Zero external dependencies (no 'ws' package). Supports text frames only,
 * which is all this project needs (JSON event broadcasting to the dashboard).
 *
 * Production upgrade path: swap for the 'ws' npm package if you need
 * binary frames, permessage-deflate compression, or very high connection
 * counts — the broadcast(topic, payload) call sites stay identical.
 */

const crypto = require('node:crypto');
const EventEmitter = require('node:events');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsHub extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
  }

  handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    this.clients.add(socket);
    this.emit('connection', socket);

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      buffer = this._processFrames(socket, buffer);
    });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  _processFrames(socket, buffer) {
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const opcode = firstByte & 0x0f;
      const secondByte = buffer[1];
      const masked = !!(secondByte & 0x80);
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return buffer;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return buffer;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey;
      if (masked) {
        if (buffer.length < offset + 4) return buffer;
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + payloadLen) return buffer; // wait for more

      let payload = buffer.subarray(offset, offset + payloadLen);
      if (masked) {
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
        payload = unmasked;
      }

      if (opcode === 0x8) { // close
        socket.end();
      } else if (opcode === 0x1) { // text frame
        this.emit('message', socket, payload.toString('utf8'));
      } else if (opcode === 0x9) { // ping -> pong
        this._sendFrame(socket, Buffer.alloc(0), 0xA);
      }

      buffer = buffer.subarray(offset + payloadLen);
    }
    return buffer;
  }

  _sendFrame(socket, payload, opcode = 0x1) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { socket.write(Buffer.concat([header, payload])); } catch { /* client gone */ }
  }

  send(socket, obj) {
    this._sendFrame(socket, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  broadcast(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    for (const socket of this.clients) this._sendFrame(socket, payload);
  }
}

module.exports = { WsHub };
