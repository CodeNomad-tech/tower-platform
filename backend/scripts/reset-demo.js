'use strict';
// Deletes the local demo database so the next start regenerates fresh simulated history.
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.DB_PATH || path.join(__dirname, '../data/toweriq.db');
for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
console.log(`Demo database reset (${file}). Run "npm start" to regenerate.`);
