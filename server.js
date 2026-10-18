#!/usr/bin/env node
// Titik masuk server Node.js (tanpa dependensi, Node 20+).
//   node server.js --init              buat config.json dengan password & secret acak
//   node server.js [-c config.json]    jalankan server
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError } from './server/config.js';
import { Store } from './server/store.js';
import { createApp } from './server/app.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (...names) => { const i = args.findIndex((a) => names.includes(a)); return i >= 0 ? args[i + 1] : undefined; };
const configFile = path.resolve(flag('-c', '--config') ?? 'config.json');
const stamp = () => new Date().toISOString();
const log = (m) => console.log(`${stamp()} ${m}`);

if (args.includes('-h') || args.includes('--help')) {
  console.log('Pemakaian: node server.js [--init] [-c config.json]');
  process.exit(0);
}

if (args.includes('--init')) {
  if (existsSync(configFile)) {
    console.error(`${configFile} sudah ada, tidak ditimpa. Hapus dulu bila ingin membuat ulang.`);
    process.exit(1);
  }
  const password = randomBytes(9).toString('base64url');
  const cfg = {
    listen_addr: ':8080',
    base_url: '',
    data_dir: './data',
    timezone: 'Asia/Jakarta',
    admin: { username: 'admin', password },
    session_secret: randomBytes(32).toString('hex'),
    session_ttl_hours: 12,
    trust_proxy: false,
  };
  writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  console.log(`Dibuat: ${configFile}\n\nLogin admin\n  username: admin\n  password: ${password}\n\nSimpan password ini. Jalankan server dengan: npm start`);
  process.exit(0);
}

let config;
try {
  config = loadConfig(configFile);
} catch (e) {
  if (e instanceof ConfigError) { console.error(`Konfigurasi bermasalah: ${e.message}`); process.exit(1); }
  throw e;
}

const store = new Store(config.data_dir, { log });
await store.init();
const server = createServer(createApp({ config, store, root, log }));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${config.port} sudah dipakai. Ubah listen_addr di config.json.` : e.message);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const shown = config.base_url || `http://localhost:${config.port}`;
  log(`Transfer Checklist berjalan di ${shown} (data: ${config.data_dir})`);
  log(`Halaman admin: ${shown}/#/admin`);
});

function shutdown(signal) {
  log(`${signal} diterima, menutup server…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
