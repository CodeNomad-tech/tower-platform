'use strict';
// Creates (or resets the password of) an admin user for production deployments.
// Usage: npm run create-admin -- you@example.com
const readline = require('node:readline');
const db = require('../src/db');
const { hashPassword } = require('../src/auth/passwords');

const email = (process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Usage: npm run create-admin -- <email>'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('New password (min 10 chars): ', (pw) => {
  rl.close();
  if (!pw || pw.length < 10) { console.error('Password too short'); process.exit(1); }
  const { hash, salt } = hashPassword(pw);
  db.run(`INSERT INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, 'admin')
          ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt, role = 'admin'`, [email, hash, salt]);
  console.log(`Admin ${email} ready.`);
});
