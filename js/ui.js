// Bagian tampilan bersama: konfigurasi, layout, flash, chip, dan pemuatan data event.
import config from './settings.js';
import { todayIn, eventState, STATE_LABEL, statusLabel, rupiah, formatDate } from './core.js';
import { fetchPublished } from './api.js';
import { h } from './dom.js';
import { currentSession, logout } from './session.js';

export { config };
export const tz = config.timezone || 'Asia/Jakarta';
export const appName = config.app_name || 'Transfer Checklist';

// Tanggal server/database (bukan jam perangkat) dipakai untuk menentukan periode.
let serverToday = null;
export const today = () => serverToday ?? todayIn(tz);

// ----- data event: selalu diambil ulang dari backend (tanggal "hari ini" mengikuti server/database) -----
export async function loadPublished() {
  const pub = await fetchPublished();
  if (pub.today) serverToday = pub.today;
  return pub;
}

// ----- pesan sekali tampil -----
let pendingFlash = null;
export const flash = (kind, text) => { pendingFlash = { kind, text }; };
export function takeFlash() {
  const f = pendingFlash;
  pendingFlash = null;
  return f ? h('div', { class: `flash ${f.kind}`, role: f.kind === 'err' ? 'alert' : 'status' }, f.text) : null;
}

export const go = (hash) => { location.hash = hash; };

// ----- potongan UI -----
export function stateChip(ev) {
  const s = eventState(ev, today());
  return h('span', { class: `chip ${s}` }, STATE_LABEL[s]);
}

export const statusChip = (status) => h('span', { class: `chip ${status}` }, statusLabel(status));

/** Satu baris ringkasan periode, mis. "Open until 23 Oct 2026". */
export function periodLine(ev) {
  const state = eventState(ev, today());
  if (state === 'open') return `Open until ${formatDate(ev.end_date)}`;
  if (state === 'upcoming') return `Opens ${formatDate(ev.start_date)}`;
  return ev.closed_at ? 'Closed by an admin' : `Ended ${formatDate(ev.end_date)}`;
}

/** Rentang tanggal input, mis. "18 Oct 2026 – 23 Oct 2026". */
export function periodText(ev) {
  return ev.start_date === ev.end_date ? formatDate(ev.start_date) : `${formatDate(ev.start_date)} – ${formatDate(ev.end_date)}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ringkasan jumlah entri dalam satu baris; angka nol tidak ditampilkan. */
export function countsText(s) {
  const parts = [plural(s.total, 'entry', 'entries')];
  if (s.pending) parts.push(`${s.pending} pending`);
  if (s.valid) parts.push(`${s.valid} valid (${rupiah(s.valid_amount)})`);
  if (s.invalid) parts.push(`${s.invalid} invalid`);
  return parts.join(' · ');
}

export function field(label, input, hint, id) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

// ----- kerangka halaman -----
export function layout(content, { admin = false, keepFlash = false } = {}) {
  const session = currentSession();
  const nav = h('nav', { 'aria-label': 'Main' },
    admin && session ? [
      h('a', { href: '#/admin' }, 'Events'),
      h('button', { class: 'linklike', type: 'button', onclick: async () => { await logout(); go('#/'); } }, `Sign out (${session.u})`),
    ] : null);
  const header = h('header', { class: 'site' }, h('div', { class: 'container' },
    h('a', { class: 'brand', href: '#/' }, appName), nav));
  const footer = session ? null : h('footer', { class: 'site muted small' }, h('div', { class: 'container' },
    h('a', { href: '#/admin/login' }, 'Admin'),
    config.repo_url ? h('a', { href: config.repo_url, rel: 'noopener noreferrer' }, 'Source code') : null));
  const main = h('main', { class: 'container', id: 'app', tabindex: '-1' }, keepFlash ? null : takeFlash(), content);
  return [header, main, footer];
}

export function notFound(message = 'Page not found.') {
  return h('div', { class: 'card' }, h('h1', null, 'Not found'), h('p', null, message), h('a', { href: '#/' }, 'Back to events'));
}

export function errorBox(message) {
  return h('div', { class: 'flash err', role: 'alert' }, message);
}
