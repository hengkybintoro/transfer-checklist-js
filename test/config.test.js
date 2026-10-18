import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, parseListen, ConfigError } from '../server/config.js';

const good = { admin: { username: 'admin', password: 'rahasia-123' }, session_secret: 'x'.repeat(32) };

test('config valid dengan default', () => {
  const c = buildConfig(good, {}, '/srv/app');
  assert.equal(c.port, 8080);
  assert.equal(c.host, undefined);
  assert.equal(c.data_dir, '/srv/app/data');
  assert.equal(c.timezone, 'Asia/Jakarta');
  assert.equal(c.trust_proxy, false);
  assert.equal(c.secure, false);
  assert.equal(c.session_ttl_ms, 12 * 3600 * 1000);
});

test('config menolak nilai berbahaya', () => {
  const bad = [
    [{}, /admin.username/],
    [{ admin: { username: 'a' }, session_secret: 'x'.repeat(32) }, /admin.password/],
    [{ ...good, session_secret: 'pendek' }, /minimal 32/],
    [{ ...good, session_secret: 'ganti-dengan-secret-acak-minimal-32-karakter' }, /nilai contoh/],
    [{ ...good, admin: { username: 'a', password: 'ganti-dengan-password-kuat' } }, /nilai contoh/],
    [{ ...good, nope: 1 }, /tidak dikenal/],
    [{ ...good, admin: { username: 'a', password: 'b', extra: 1 } }, /tidak dikenal/],
    [{ ...good, timezone: 'Mars/Olimpus' }, /Zona waktu/],
    [{ ...good, base_url: 'ftp://x' }, /base_url/],
    [{ ...good, base_url: 'https://x.com/path' }, /base_url/],
    [{ ...good, listen_addr: 'abc' }, /listen_addr/],
    [{ ...good, session_ttl_hours: 0 }, /session_ttl_hours/],
    [[], /objek/],
  ];
  for (const [raw, re] of bad) assert.throws(() => buildConfig(raw, {}), (e) => e instanceof ConfigError && re.test(e.message), JSON.stringify(raw));
});

test('environment menimpa config.json', () => {
  const c = buildConfig(good, {
    TC_LISTEN_ADDR: '127.0.0.1:9000', TC_BASE_URL: 'https://t.example.com/', TC_TRUST_PROXY: 'true',
    TC_ADMIN_PASSWORD: 'dari-env-123', TC_DATA_DIR: '/var/tc', TC_SESSION_TTL_HOURS: '2',
  });
  assert.equal(c.port, 9000);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.base_url, 'https://t.example.com');
  assert.equal(c.secure, true);
  assert.equal(c.trust_proxy, true);
  assert.equal(c.admin.password, 'dari-env-123');
  assert.equal(c.data_dir, '/var/tc');
  assert.equal(c.session_ttl_ms, 2 * 3600 * 1000);
  assert.throws(() => buildConfig(good, { TC_TRUST_PROXY: 'mungkin' }), ConfigError);
});

test('parseListen', () => {
  assert.deepEqual(parseListen(':8080'), { host: undefined, port: 8080 });
  assert.deepEqual(parseListen('0.0.0.0:3000'), { host: '0.0.0.0', port: 3000 });
  assert.deepEqual(parseListen('[::1]:80'), { host: '::1', port: 80 });
  assert.throws(() => parseListen('8080'), ConfigError);
  assert.throws(() => parseListen(':99999'), ConfigError);
});
