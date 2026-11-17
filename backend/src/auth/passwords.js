'use strict';
const crypto = require('node:crypto');

// scrypt KDF from node:crypto (no bcrypt dependency).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(candidate, stored);
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

module.exports = { hashPassword, verifyPassword, sha256 };
