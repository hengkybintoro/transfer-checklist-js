// Bagian tampilan bersama: konfigurasi, layout, flash, chip, dan pemuatan data event.
import config from './settings.js';
import { todayIn, eventState, STATE_LABEL, statusLabel, rupiah, dateID } from './core.js';
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

const ICON = { pending: '…', valid: '✓', invalid: '✗' };
export function statusChip(status) {
  return h('span', { class: `chip ${status}` }, `${ICON[status] ?? ''} ${statusLabel(status)}`.trim());
}

export function periodText(ev) {
  return ev.start_date === ev.end_date ? dateID(ev.start_date) : `${dateID(ev.start_date)} – ${dateID(ev.end_date)}`;
}

export function statsStrip(s) {
  const stat = (label, value) => h('div', { class: 'stat' }, h('b', null, value), h('span', { class: 'muted small' }, label));
  return h('div', { class: 'stats' },
    stat('Entri', String(s.total)),
    stat('Menunggu', String(s.pending)),
    stat('Valid', `${s.valid} · ${rupiah(s.valid_amount)}`),
    stat('Tidak valid', String(s.invalid)));
}

export function field(label, input, hint, id) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

// ----- kerangka halaman -----
export function layout(content, { admin = false, keepFlash = false } = {}) {
  const session = currentSession();
  const nav = h('nav', { 'aria-label': 'Navigasi' },
    admin && session ? [
      h('a', { class: 'btn sm', href: '#/admin' }, 'Dashboard'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { await logout(); flash('ok', 'Anda sudah keluar.'); go('#/'); } }, `Keluar (${session.u})`),
    ] : null);
  const header = h('header', { class: 'site' }, h('div', { class: 'container' },
    h('a', { class: 'brand', href: '#/' }, appName), nav));
  const footer = h('footer', { class: 'site muted small' }, h('div', { class: 'container' },
    h('span', null, 'Data dicatat peserta dan diverifikasi admin terhadap mutasi rekening.'),
    h('span', null,
      h('a', { href: session ? '#/admin' : '#/admin/login' }, 'Admin'),
      config.repo_url ? [' · ', h('a', { href: config.repo_url, rel: 'noopener noreferrer' }, 'Kode sumber')] : null)));
  const main = h('main', { class: 'container', id: 'app', tabindex: '-1' }, keepFlash ? null : takeFlash(), content);
  return [header, main, footer];
}

export function notFound(message = 'Halaman tidak ditemukan.') {
  return h('div', { class: 'card' }, h('h1', null, 'Tidak ditemukan'), h('p', null, message), h('a', { class: 'btn', href: '#/' }, 'Ke beranda'));
}

export function errorBox(message) {
  return h('div', { class: 'flash err', role: 'alert' }, message);
}
