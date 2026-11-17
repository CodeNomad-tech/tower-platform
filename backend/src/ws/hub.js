'use strict';
/**
 * Minimal WebSocket server (RFC 6455) on node:http's 'upgrade' event.
 * Zero dependencies. Text frames only.
 *
 * Every connection must authenticate during the handshake:
 *   /ws?token=<session token>   → console client: receives live events
 *   /ws?device=<device key>     → field device (camera node): may SEND events, receives nothing
 * Unauthenticated upgrades get HTTP 401. Frames over 64 KB close the socket.
 */

const crypto = require('node:crypto');
const EventEmitter = require('node:events');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 64 * 1024;

class WsHub extends EventEmitter {
  /** authenticate(req, url) → { kind: 'user'|'device', ... } | null */
  constructor({ authenticate } = {}) {
    super();
    this.clients = new Map(); // socket -> identity
    this.authenticate = authenticate || (() => ({ kind: 'user' }));
  }

  handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    const url = new URL(req.url, 'http://local');
    const identity = key ? this.authenticate(req, url) : null;
    if (!identity) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    this.clients.set(socket, identity);
    this.emit('connection', socket, identity);

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME + 14) { socket.destroy(); return; }
      buffer = this._processFrames(socket, buffer);
    });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  _processFrames(socket, buffer) {
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = !!(buffer[1] & 0x80);
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) { if (buffer.length < 4) return buffer; len = buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (buffer.length < 10) return buffer; len = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (len > MAX_FRAME) { socket.destroy(); return Buffer.alloc(0); }
      let mask;
      if (masked) { if (buffer.length < offset + 4) return buffer; mask = buffer.subarray(offset, offset + 4); offset += 4; }
      if (buffer.length < offset + len) return buffer;
      let payload = buffer.subarray(offset, offset + len);
      if (masked) { const u = Buffer.alloc(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i % 4]; payload = u; }
      if (opcode === 0x8) socket.end();
      else if (opcode === 0x1) this.emit('message', socket, payload.toString('utf8'), this.clients.get(socket));
      else if (opcode === 0x9) this._sendFrame(socket, payload, 0xA);
      buffer = buffer.subarray(offset + len);
    }
    return buffer;
  }

  _sendFrame(socket, payload, opcode = 0x1) {
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    try { socket.write(Buffer.concat([header, payload])); } catch { /* client gone */ }
  }

  send(socket, obj) { this._sendFrame(socket, Buffer.from(JSON.stringify(obj), 'utf8')); }

  // Broadcasts to authenticated console users only (devices don't receive fleet data).
  broadcast(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    for (const [socket, id] of this.clients) if (id.kind === 'user') this._sendFrame(socket, payload);
  }

  closeAll() { for (const s of this.clients.keys()) s.destroy(); this.clients.clear(); }
}

module.exports = { WsHub };
