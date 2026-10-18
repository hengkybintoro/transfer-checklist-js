// Handler HTTP: file statis (frontend yang sama dengan mode Supabase) + API JSON.
// Semua aturan bisnis memakai js/core.js, sama persis dengan yang dipakai browser.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  UserError, todayIn, submitBlockReason, newEntry, setStatus, deleteEntry, closeEvent, reopenEvent, updateEventInfo,
  validId, LIMITS,
} from '../js/core.js';
import { Sessions, Limiter, COOKIE, parseCookies, cookieHeader, secureEqual } from './auth.js';
import { NotFoundError } from './store.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const ENTRY_ID = /^[a-f0-9]{16}$/;
const BODY_LIMIT = 16 * 1024;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const stripNotes = (ev) => ({ ...ev, entries: ev.entries.map((e) => (e.status === 'invalid' ? e : { ...e, admin_note: '' })) });

export function createApp({ config, store, root, now = () => new Date(), log = () => {} }) {
  const tz = config.timezone;
  const nowMs = () => now().getTime();
  const sessions = new Sessions(config.session_secret, config.session_ttl_ms, nowMs);
  const loginLimiter = new Limiter({ max: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000, now: nowMs });
  const entryLimiter = new Limiter({ max: 10, windowMs: 60_000, now: nowMs });
  const clientConfigJs = `export default ${JSON.stringify({ app_name: 'Transfer Checklist', timezone: tz, mode: 'server', repo_url: '' })};\n`;

  function clientIp(req) {
    if (config.trust_proxy) {
      const h = req.headers;
      const cf = h['cf-connecting-ip'];
      if (cf) return String(cf).trim();
      const xff = h['x-forwarded-for'];
      if (xff) return String(xff).split(',')[0].trim();
      if (h['x-real-ip']) return String(h['x-real-ip']).trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function baseHeaders(res) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  function send(res, status, body, headers = {}) {
    const isStr = typeof body === 'string';
    const payload = isStr ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': isStr ? (headers['Content-Type'] ?? 'text/plain; charset=utf-8') : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(payload);
  }

  async function readJson(req, limit = BODY_LIMIT) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Content-Type harus application/json.');
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'Permintaan terlalu besar.');
    const chunks = [];
    let size = 0;
    let tooBig = false;
    await new Promise((resolve, reject) => {
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { tooBig = true; chunks.length = 0; if (size > limit * 64) req.destroy(); return; }
        if (!tooBig) chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', reject);
      req.on('close', resolve);
    });
    if (tooBig) throw new HttpError(413, 'Permintaan terlalu besar.');
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Body bukan JSON yang valid.'); }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Body harus berupa objek JSON.');
    return data;
  }

  function checkOrigin(req) {
    if (req.headers['x-tc-request'] !== '1') throw new HttpError(403, 'Permintaan ditolak (header keamanan tidak ada).');
    const origin = req.headers.origin;
    if (!origin) return;
    let host;
    try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Origin tidak valid.'); }
    const ok = host === req.headers.host
      || (config.base_url && origin === config.base_url)
      || (config.trust_proxy && host === req.headers['x-forwarded-host']);
    if (!ok) throw new HttpError(403, 'Origin tidak diizinkan.');
  }

  const sessionOf = (req) => sessions.verify(parseCookies(req.headers.cookie)[COOKIE]);

  function needAdmin(req) {
    const s = sessionOf(req);
    if (!s) throw new HttpError(401, 'Sesi admin tidak ada atau sudah berakhir. Silakan login.');
    return s;
  }

  // ----- file statis -----
  async function serveStatic(req, res, pathname) {
    if (pathname === '/config.js') {
      send(res, 200, clientConfigJs, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
      return true;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return true; }
    const rel = pathname === '/' ? '/index.html' : pathname;
    if (!(rel === '/index.html' || rel.startsWith('/css/') || rel.startsWith('/js/'))) return false;
    if (rel.includes('\0') || rel.split('/').includes('..')) return false;
    const abs = path.join(root, rel);
    if (!abs.startsWith(root + path.sep)) return false;
    const type = MIME[path.extname(abs)];
    if (!type) return false;
    let st;
    try { st = await stat(abs); } catch { return false; }
    if (!st.isFile()) return false;
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return true; }
    createReadStream(abs).pipe(res);
    return true;
  }

  // ----- API -----
  async function api(req, res, pathname, ip) {
    const method = req.method;
    const parts = pathname.split('/').filter(Boolean).slice(1); // buang "api"
    const [a, b, c, d, e, f] = parts;
    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating) checkOrigin(req);

    if (a === 'session' && parts.length === 1 && method === 'GET') {
      const s = sessionOf(req);
      return send(res, 200, { admin: s ? { u: s.u } : null });
    }

    if (a === 'events' && parts.length === 1 && method === 'GET') {
      const list = await store.list();
      return send(res, 200, { today: todayIn(tz, now()), events: sessionOf(req) ? list : list.map(stripNotes) });
    }

    if (a === 'events' && c === 'entries' && parts.length === 3 && method === 'POST') {
      if (!validId(b)) throw new NotFoundError('Event tidak ditemukan.');
      if (!entryLimiter.allow(ip)) throw new HttpError(429, 'Terlalu banyak input. Coba lagi sebentar lagi.');
      const body = await readJson(req);
      let created;
      await store.update(b, (ev) => {
        const today = todayIn(tz, now());
        const reason = submitBlockReason(ev, today);
        if (reason) throw new UserError(reason);
        if (ev.entries.length >= LIMITS.entries) throw new UserError('Jumlah entri event ini sudah mencapai batas.');
        created = newEntry({ name: body.name, amount: String(body.amount ?? ''), transfer_date: body.transfer_date }, today, now());
        ev.entries.push(created);
        return ev;
      });
      return send(res, 201, { entry: { ...created, admin_note: '' } });
    }

    if (a !== 'admin') throw new HttpError(404, 'Endpoint tidak ditemukan.');

    if (b === 'login' && parts.length === 2) {
      if (method !== 'POST') throw new HttpError(405, 'Metode tidak diizinkan.');
      const wait = loginLimiter.isBlocked(ip);
      if (wait) throw new HttpError(429, `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(wait / 60000)} menit.`);
      const body = await readJson(req);
      const okUser = secureEqual(body.username ?? '', config.admin.username);
      const okPass = secureEqual(body.password ?? '', config.admin.password);
      if (!(okUser && okPass)) {
        loginLimiter.fail(ip);
        throw new HttpError(401, 'Username atau password salah.');
      }
      loginLimiter.reset(ip);
      const token = sessions.create(config.admin.username);
      return send(res, 200, { admin: { u: config.admin.username } }, {
        'Set-Cookie': cookieHeader(token, { secure: config.secure, maxAgeSec: Math.floor(config.session_ttl_ms / 1000) }),
      });
    }

    if (b === 'logout' && parts.length === 2) {
      if (method !== 'POST') throw new HttpError(405, 'Metode tidak diizinkan.');
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', { secure: config.secure, maxAgeSec: 0 }) });
    }

    const sess = needAdmin(req);
    if (b !== 'events') throw new HttpError(404, 'Endpoint tidak ditemukan.');

    if (parts.length === 2 && method === 'POST') {
      const ev = await store.create(await readJson(req), now());
      return send(res, 201, { event: ev });
    }

    if (!validId(c)) throw new NotFoundError('Event tidak ditemukan.');

    if (parts.length === 3 && method === 'PUT') {
      const body = await readJson(req);
      return send(res, 200, { event: await store.update(c, (ev) => updateEventInfo(ev, body)) });
    }
    if (parts.length === 4 && d === 'close' && method === 'POST') {
      return send(res, 200, { event: await store.update(c, (ev) => closeEvent(ev, sess.u, now())) });
    }
    if (parts.length === 4 && d === 'reopen' && method === 'POST') {
      return send(res, 200, { event: await store.update(c, (ev) => reopenEvent(ev)) });
    }
    if (parts.length === 4 && d === 'entries' && method === 'POST') {
      const body = await readJson(req);
      return send(res, 201, { event: await store.update(c, (ev) => {
        if (ev.entries.length >= LIMITS.entries) throw new UserError('Jumlah entri event ini sudah mencapai batas.');
        ev.entries.push(newEntry({ name: body.name, amount: String(body.amount ?? ''), transfer_date: body.transfer_date }, todayIn(tz, now()), now()));
        return ev;
      }) });
    }
    if (d === 'entries' && ENTRY_ID.test(e ?? '')) {
      if (parts.length === 6 && f === 'status' && method === 'POST') {
        const body = await readJson(req);
        return send(res, 200, { event: await store.update(c, (ev) => setStatus(ev, e, body.status, body.note ?? '', now())) });
      }
      if (parts.length === 5 && method === 'DELETE') {
        return send(res, 200, { event: await store.update(c, (ev) => deleteEntry(ev, e)) });
      }
    }
    throw new HttpError(404, 'Endpoint tidak ditemukan.');
  }

  return async function handler(req, res) {
    const started = Date.now();
    const ip = clientIp(req);
    let pathname = '/';
    baseHeaders(res);
    try {
      try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { throw new HttpError(400, 'URL tidak valid.'); }

      if (pathname === '/healthz') {
        send(res, 200, 'ok\n');
      } else if (pathname === '/api' || pathname.startsWith('/api/')) {
        await api(req, res, pathname, ip);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        if (!(await serveStatic(req, res, pathname))) send(res, 404, 'Tidak ditemukan\n');
      } else {
        throw new HttpError(405, 'Metode tidak diizinkan.');
      }
    } catch (err) {
      let status = 500;
      let message = 'Terjadi kesalahan di server.';
      if (err instanceof HttpError) { status = err.status; message = err.message; }
      else if (err instanceof NotFoundError) { status = 404; message = err.message; }
      else if (err instanceof UserError) { status = /tidak ditemukan\.$/.test(err.message) ? 404 : 400; message = err.message; }
      else log(`ERROR ${req.method} ${pathname}: ${err.stack ?? err}`);
      if (!res.headersSent) send(res, status, { error: message }, status === 413 ? { Connection: 'close' } : {});
      else res.end();
    }
    log(`${ip} ${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
  };
}
