// Konfigurasi server: config.json + override environment (TC_*). Menolak nilai contoh/lemah.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const KNOWN = ['listen_addr', 'base_url', 'data_dir', 'timezone', 'admin', 'session_secret', 'session_ttl_hours', 'trust_proxy'];
const PLACEHOLDER = /ganti-dengan/i;

export class ConfigError extends Error {}

function parseBool(v, name) {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'ya'].includes(s)) return true;
  if (['0', 'false', 'no', 'tidak', ''].includes(s)) return false;
  throw new ConfigError(`${name} harus true/false.`);
}

export function parseListen(addr) {
  const m = /^(.*):(\d{1,5})$/.exec(String(addr).trim());
  if (!m) throw new ConfigError(`listen_addr tidak valid: "${addr}" (contoh ":8080" atau "127.0.0.1:8080").`);
  const port = Number(m[2]);
  if (port < 0 || port > 65535) throw new ConfigError('Port listen_addr di luar rentang.');
  return { host: m[1] === '' ? undefined : m[1].replace(/^\[|\]$/g, ''), port };
}

/**
 * @param {object} raw  isi config.json (sudah di-parse)
 * @param {Record<string,string|undefined>} env
 * @param {string} baseDir  folder acuan untuk data_dir relatif
 */
export function buildConfig(raw, env = {}, baseDir = process.cwd()) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('config.json harus berupa objek JSON.');
  for (const k of Object.keys(raw)) if (!KNOWN.includes(k)) throw new ConfigError(`Field tidak dikenal di config.json: "${k}".`);
  const admin = raw.admin ?? {};
  if (typeof admin !== 'object') throw new ConfigError('admin harus berupa objek.');
  for (const k of Object.keys(admin)) if (!['username', 'password'].includes(k)) throw new ConfigError(`Field tidak dikenal di admin: "${k}".`);

  const c = {
    listen_addr: env.TC_LISTEN_ADDR ?? raw.listen_addr ?? ':8080',
    base_url: (env.TC_BASE_URL ?? raw.base_url ?? '').trim().replace(/\/+$/, ''),
    data_dir: env.TC_DATA_DIR ?? raw.data_dir ?? './data',
    timezone: env.TC_TIMEZONE ?? raw.timezone ?? 'Asia/Jakarta',
    admin: {
      username: env.TC_ADMIN_USERNAME ?? admin.username ?? '',
      password: env.TC_ADMIN_PASSWORD ?? admin.password ?? '',
    },
    session_secret: env.TC_SESSION_SECRET ?? raw.session_secret ?? '',
    session_ttl_hours: Number(env.TC_SESSION_TTL_HOURS ?? raw.session_ttl_hours ?? 12),
    trust_proxy: parseBool(env.TC_TRUST_PROXY ?? raw.trust_proxy ?? false, 'trust_proxy'),
  };

  if (!c.admin.username) throw new ConfigError('admin.username wajib diisi.');
  if (!c.admin.password) throw new ConfigError('admin.password wajib diisi.');
  if (PLACEHOLDER.test(c.admin.password) || PLACEHOLDER.test(c.session_secret)) {
    throw new ConfigError('admin.password / session_secret masih berisi nilai contoh. Ganti dulu (atau jalankan: node server.js --init).');
  }
  if (c.session_secret.length < 32) throw new ConfigError('session_secret wajib diisi minimal 32 karakter acak (contoh: openssl rand -hex 32).');
  if (!Number.isFinite(c.session_ttl_hours) || c.session_ttl_hours <= 0 || c.session_ttl_hours > 24 * 30) throw new ConfigError('session_ttl_hours harus 1–720.');
  if (c.base_url && !/^https?:\/\/[^\s/]+$/.test(c.base_url)) throw new ConfigError('base_url harus berbentuk https://host[:port] tanpa path.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: c.timezone }); } catch { throw new ConfigError(`Zona waktu "${c.timezone}" tidak dikenal.`); }

  const listen = parseListen(c.listen_addr);
  return {
    ...c,
    host: listen.host,
    port: listen.port,
    data_dir: path.resolve(baseDir, c.data_dir),
    secure: c.base_url.startsWith('https://'),
    session_ttl_ms: c.session_ttl_hours * 3600 * 1000,
  };
}

export function loadConfig(file, env = process.env) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') throw new ConfigError(`File konfigurasi tidak ditemukan: ${file}\nBuat dengan: node server.js --init`);
    throw e;
  }
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new ConfigError(`config.json bukan JSON yang valid: ${e.message}`); }
  return buildConfig(raw, env, path.dirname(path.resolve(file)));
}
