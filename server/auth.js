// Sesi admin (cookie bertanda tangan HMAC), perbandingan kredensial waktu-konstan, dan rate limiter.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'tc_session';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function secureEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export class Sessions {
  constructor(secret, ttlMs, now = () => Date.now()) {
    this.secret = secret;
    this.ttl = ttlMs;
    this.now = now;
  }

  sign(data) {
    return b64u(createHmac('sha256', this.secret).update(data).digest());
  }

  create(user) {
    const payload = b64u(JSON.stringify({ u: user, exp: this.now() + this.ttl }));
    return `${payload}.${this.sign(payload)}`;
  }

  /** @returns {{u: string, exp: number} | null} */
  verify(token) {
    if (typeof token !== 'string' || token.length > 512) return null;
    const i = token.indexOf('.');
    if (i < 1) return null;
    const payload = token.slice(0, i);
    const sig = token.slice(i + 1);
    const want = this.sign(payload);
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    try {
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof p.u !== 'string' || typeof p.exp !== 'number' || p.exp < this.now()) return null;
      return p;
    } catch {
      return null;
    }
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookieHeader(value, { secure, maxAgeSec }) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** Pembatas laju per kunci (mis. IP). Jendela geser untuk hit(), blokir sementara untuk fail(). */
export class Limiter {
  constructor({ max, windowMs, blockMs = 0, now = () => Date.now() }) {
    Object.assign(this, { max, windowMs, blockMs, now });
    this.hits = new Map();
    this.blocked = new Map();
  }

  /** Mencatat satu kejadian; true bila masih di bawah batas. */
  allow(key) {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.max) { this.hits.set(key, list); return false; }
    list.push(t);
    this.hits.set(key, list);
    this.sweep(t);
    return true;
  }

  isBlocked(key) {
    const until = this.blocked.get(key);
    if (!until) return 0;
    if (until <= this.now()) { this.blocked.delete(key); return 0; }
    return until - this.now();
  }

  /** Mencatat kegagalan; memblokir bila mencapai batas dalam jendela. */
  fail(key) {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    list.push(t);
    this.hits.set(key, list);
    if (list.length >= this.max) {
      this.blocked.set(key, t + this.blockMs);
      this.hits.delete(key);
    }
    this.sweep(t);
  }

  reset(key) {
    this.hits.delete(key);
    this.blocked.delete(key);
  }

  sweep(t) {
    if (this.hits.size < 5000) return;
    for (const [k, list] of this.hits) if (!list.some((x) => t - x < this.windowMs)) this.hits.delete(k);
  }
}
