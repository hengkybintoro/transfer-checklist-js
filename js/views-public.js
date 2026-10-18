// Halaman publik: beranda (event aktif) dan halaman event (form + daftar entri).
import {
  isActive, eventState, submitBlockReason, validateEntryInput, newEntry, encodeEntryCode, summary, sortEntries,
  rupiah, dateID, dateTimeID, UserError,
} from './core.js';
import { h, copyText } from './dom.js';
import { config, tz, today, loadPublished, stateChip, statusChip, periodText, statsStrip, field, notFound, flash } from './ui.js';
import { myEntries, addMyEntry, removeMyEntry } from './storage.js';
import { isServer, serverApi } from './mode.js';

let justSubmitted = null; // id entri yang baru dikirim (menampilkan panel kode kirim)

function pubWarnings(pub) {
  if (!pub.errors.length) return null;
  return h('div', { class: 'flash warn', role: 'status' },
    `Sebagian event gagal dimuat: ${pub.errors.map((e) => `${e.id} (${e.message})`).join('; ')}.`);
}

// ---------- beranda ----------

export async function renderHome() {
  const pub = await loadPublished();
  const t = today();
  const active = pub.events.filter((e) => isActive(e, t));

  const body = [h('h1', null, 'Event Aktif'), h('p', { class: 'muted' }, 'Pilih event untuk mencatat transfer Anda dan melihat status verifikasinya.')];
  body.push(pubWarnings(pub));
  if (pub.missing) {
    body.push(h('div', { class: 'card empty' }, 'Belum ada data event yang diterbitkan.'));
  } else if (!active.length) {
    body.push(h('div', { class: 'card empty' }, 'Belum ada event yang sedang dibuka. Silakan cek lagi nanti.'));
  } else {
    body.push(h('div', { class: 'grid' }, active.map((ev) => {
      const s = summary(ev);
      return h('a', { class: 'event-card', href: `#/e/${ev.id}` },
        h('strong', null, ev.name),
        h('div', { class: 'muted small' }, `Input sampai ${dateID(ev.end_date)}`),
        h('div', { class: 'row', style: 'margin-top:8px' }, stateChip(ev), h('span', { class: 'muted small' }, `${s.total} entri · ${s.valid} valid`)));
    })));
  }
  return body;
}

// ---------- halaman event ----------

function waLink(ev, e, code) {
  const text = [
    `Transfer Checklist: ${ev.name}`,
    `Nama: ${e.name}`,
    `Nominal: ${rupiah(e.amount)}`,
    `Tgl transfer: ${dateID(e.transfer_date)}`,
    '',
    `Kode: ${code}`,
  ].join('\n');
  const num = /^\d{8,15}$/.test(String(config.admin_whatsapp ?? '')) ? config.admin_whatsapp : '';
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

function sendButtons(ev, item, rerender) {
  const copy = h('button', { class: 'btn sm', type: 'button' }, 'Salin kode');
  copy.addEventListener('click', async () => {
    copy.textContent = (await copyText(item.code)) ? 'Tersalin ✓' : 'Gagal menyalin — salin manual';
  });
  return [
    copy,
    h('a', { class: 'btn sm', href: waLink(ev, item, item.code), target: '_blank', rel: 'noopener noreferrer' }, 'Kirim lewat WhatsApp'),
    h('button', { class: 'btn sm danger', type: 'button', onclick: () => { removeMyEntry(item.id); rerender(); } }, 'Hapus dari perangkat'),
  ];
}

function mineCard(ev, rerender) {
  const mine = myEntries().filter((x) => x.eventId === ev.id);
  if (!mine.length) return null;
  const published = new Map(ev.entries.map((e) => [e.id, e]));
  return h('div', { class: 'card' },
    h('h2', null, 'Entri Anda di perangkat ini'),
    h('p', { class: 'muted small' }, 'Entri baru berstatus "Belum diterima admin" sampai admin memasukkannya dan menerbitkan datanya. Teruskan kode kirim ke admin.'),
    mine.map((item) => {
      const pubEntry = published.get(item.id);
      const fresh = item.id === justSubmitted;
      return h('div', { class: 'stack', style: 'padding:12px 0;border-top:1px solid var(--border)' },
        h('div', { class: 'row between' },
          h('div', null, h('strong', null, item.name), ' · ', rupiah(item.amount), ' · ', dateID(item.transfer_date)),
          pubEntry ? h('span', { class: 'row' }, h('span', { class: 'chip open' }, 'Sudah tercatat'), statusChip(pubEntry.status))
            : h('span', { class: 'chip warn' }, 'Belum diterima admin')),
        pubEntry ? null : [
          fresh ? h('div', { class: 'flash ok', role: 'status' }, 'Tersimpan di perangkat ini. Langkah terakhir: kirim kode di bawah ke admin.') : null,
          h('div', { class: 'codebox', 'aria-label': 'Kode kirim' }, item.code),
          h('div', { class: 'row' }, sendButtons(ev, item, rerender)),
        ]);
    }));
}

function entryForm(ev, rerender) {
  const t = today();
  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', id: 'f-name', name: 'name', maxlength: '80', required: true, autocomplete: 'name' });
  const amount = h('input', { type: 'text', id: 'f-amount', name: 'amount', inputmode: 'numeric', required: true, placeholder: 'mis. 1.500.000', autocomplete: 'off' });
  const date = h('input', { type: 'date', id: 'f-date', name: 'transfer_date', required: true, max: t, value: t });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Simpan entri');
  const form = h('form', { novalidate: true, class: 'card' },
    h('h2', null, 'Catat transfer'),
    err,
    field('Nama', name, 'Sesuai nama pengirim di mutasi rekening.', 'f-name'),
    h('div', { class: 'fields-2' },
      field('Nominal (Rp)', amount, 'Angka bulat, contoh 1500000 atau 1.500.000.', 'f-amount'),
      field('Tanggal transfer', date, null, 'f-date')),
    submit,
    h('p', { class: 'hint', style: 'margin-top:12px' }, isServer
      ? 'Entri langsung tercatat dengan status Menunggu, lalu diverifikasi admin terhadap mutasi rekening.'
      : 'Entri disimpan di perangkat Anda dan menghasilkan kode kirim. Teruskan kode itu ke admin supaya tercatat dan diverifikasi.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      const reason = submitBlockReason(ev, today());
      if (reason) throw new UserError(reason);
      const v = validateEntryInput({ name: name.value, amount: amount.value, transfer_date: date.value }, today());
      if (isServer) {
        // server memeriksa ulang semua aturan (periode memakai jam server)
        await serverApi('POST', `events/${ev.id}/entries`, { name: name.value, amount: amount.value, transfer_date: date.value });
        flash('ok', 'Entri tercatat dengan status Menunggu. Admin akan memverifikasinya terhadap mutasi rekening.');
      } else {
        const entry = newEntry(v, today());
        addMyEntry({ eventId: ev.id, id: entry.id, name: entry.name, amount: entry.amount, transfer_date: entry.transfer_date, submitted_at: entry.submitted_at, code: encodeEntryCode(ev.id, entry) });
        justSubmitted = entry.id;
      }
      rerender();
    } catch (x) {
      if (!(x instanceof UserError)) throw x;
      err.textContent = x.message;
      err.hidden = false;
      err.scrollIntoView({ block: 'nearest' });
      submit.disabled = false;
    }
  });
  return form;
}

function entriesTable(ev) {
  if (!ev.entries.length) return h('div', { class: 'card empty' }, 'Belum ada entri yang tercatat.');
  const rows = sortEntries(ev.entries, 'submitted', 'desc').map((e) => h('tr', null,
    h('td', { 'data-label': 'Nama' }, h('strong', null, e.name)),
    h('td', { class: 'num', 'data-label': 'Nominal' }, rupiah(e.amount)),
    h('td', { 'data-label': 'Tgl transfer', class: 'nowrap' }, dateID(e.transfer_date)),
    h('td', { 'data-label': 'Diinput', class: 'nowrap' }, dateTimeID(e.submitted_at, tz)),
    h('td', { 'data-label': 'Status' }, statusChip(e.status),
      e.status === 'invalid' && e.admin_note ? h('div', { class: 'notes' }, e.admin_note) : null)));
  return h('div', { class: 'card table-wrap' },
    h('table', { class: 'stack' },
      h('thead', null, h('tr', null, h('th', null, 'Nama'), h('th', { class: 'num' }, 'Nominal'), h('th', null, 'Tgl transfer'), h('th', null, 'Diinput'), h('th', null, 'Status'))),
      h('tbody', null, rows)));
}

export async function renderEvent(id, { rerender }) {
  const pub = await loadPublished();
  const ev = pub.byId.get(id);
  if (!ev) {
    return notFound(pub.errors.some((e) => e.id === id) ? 'Data event ini gagal dimuat. Coba lagi nanti.' : 'Event tidak ditemukan atau belum diterbitkan.');
  }
  const t = today();
  const state = eventState(ev, t);
  const reason = submitBlockReason(ev, t);

  return [
    h('p', null, h('a', { href: '#/' }, '← Semua event aktif')),
    h('div', { class: 'row between' }, h('h1', null, ev.name), stateChip(ev)),
    h('p', { class: 'muted' }, `Periode input: ${periodText(ev)}`),
    ev.description ? h('div', { class: 'card pre' }, ev.description) : null,
    state === 'open' ? entryForm(ev, rerender) : h('div', { class: 'flash warn', role: 'status' }, reason),
    isServer ? null : mineCard(ev, rerender),
    h('div', { class: 'row between' }, h('h2', null, 'Daftar entri'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { await loadPublished(true); rerender(); } }, 'Muat ulang')),
    statsStrip(summary(ev)),
    entriesTable(ev),
    h('p', { class: 'muted small' }, isServer
      ? 'Catatan admin hanya ditampilkan untuk entri tidak valid.'
      : 'Daftar ini diperbarui setiap admin menerbitkan data terbaru. Catatan admin hanya ditampilkan untuk entri tidak valid.'),
  ];
}
