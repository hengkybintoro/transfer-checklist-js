// Halaman admin: login, dashboard, form event, dan halaman verifikasi.
// Data kerja admin disimpan di browser (localStorage); "menerbitkan" = mengunduh file JSON lalu commit ke repo.
import {
  configProblem, sha256Hex, safeEqual, UserError, eventState, closedManually, closeEvent, reopenEvent, newEvent, updateEventInfo,
  newEntry, importCodes, setStatus, deleteEntry, summary, duplicates, outsidePeriod, sortEntries, serializeEvent, parseEventJSON,
  buildIndex, toCSV, rupiah, dateID, dateTimeID, STATUSES, statusLabel,
} from './core.js';
import { h, download } from './dom.js';
import {
  config, tz, today, loadPublished, flash, go, stateChip, statusChip, periodText, statsStrip, field, notFound, errorBox,
} from './ui.js';
import {
  adminEvents, saveAdminEvent, removeAdminEvent, getSession, setSession, getLock, setLock, isPersistent,
} from './storage.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

// ---------- salinan kerja ----------

const working = (id, pub) => adminEvents().get(id) ?? pub.byId.get(id) ?? null;

function publishState(id, pub) {
  const local = adminEvents().get(id);
  const published = pub.byId.get(id);
  if (!published) return { key: 'new', label: 'Belum pernah diterbitkan', cls: 'warn' };
  if (!local) return { key: 'same', label: 'Sama dengan versi terbit', cls: 'open' };
  return serializeEvent(local) === serializeEvent(published)
    ? { key: 'same', label: 'Sama dengan versi terbit', cls: 'open' }
    : { key: 'dirty', label: 'Ada perubahan belum diterbitkan', cls: 'warn' };
}

function allIds(pub) {
  return [...new Set([...adminEvents().keys(), ...pub.byId.keys()])];
}

function mutate(id, pub, fn) {
  const cur = working(id, pub);
  if (!cur) throw new UserError('Event tidak ditemukan.');
  const next = fn(cur);
  saveAdminEvent(next);
  return next;
}

/** Menjalankan aksi; UserError diubah menjadi pesan flash lalu halaman digambar ulang. */
function act(rerender, fn) {
  try { fn(); } catch (e) {
    if (!(e instanceof UserError)) throw e;
    flash('err', e.message);
  }
  rerender();
}

// ---------- login ----------

let afterLogin = '#/admin';
export const setAfterLogin = (hash) => { afterLogin = typeof hash === 'string' && hash.startsWith('#/admin') && !hash.startsWith('#/admin/login') ? hash : '#/admin'; };

export function renderLogin() {
  const problem = configProblem(config);
  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const user = h('input', { type: 'text', id: 'l-user', name: 'username', autocomplete: 'username', required: true });
  const pass = h('input', { type: 'password', id: 'l-pass', name: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn primary block', type: 'submit', disabled: Boolean(problem) }, 'Masuk');
  const show = (m) => { err.textContent = m; err.hidden = false; };

  const form = h('form', { class: 'card', novalidate: true, style: 'max-width:420px;margin:0 auto' },
    h('h1', null, 'Login Admin'),
    problem ? errorBox(problem) : null,
    err,
    field('Username', user, null, 'l-user'),
    field('Password', pass, null, 'l-pass'),
    submit,
    h('p', { class: 'hint', style: 'margin-top:12px' }, 'Login ini hanya gerbang tampilan di browser Anda. Yang benar-benar melindungi data adalah akses tulis ke repositori GitHub.'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (problem) return;
    const lock = getLock();
    if (lock.until > Date.now()) {
      show(`Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil((lock.until - Date.now()) / 60000)} menit.`);
      return;
    }
    submit.disabled = true;
    try {
      const hash = await sha256Hex(pass.value);
      const okUser = safeEqual(user.value.trim(), config.admin.username);
      const okPass = safeEqual(hash, String(config.admin.password_sha256).toLowerCase());
      if (okUser && okPass) {
        setLock({ fails: 0, until: 0 });
        setSession({ u: config.admin.username, exp: Date.now() + (Number(config.session_hours) || 12) * 3600 * 1000 });
        flash('ok', 'Berhasil masuk.');
        go(afterLogin);
        return;
      }
      const fails = (lock.fails || 0) + 1;
      setLock(fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MS } : { fails, until: 0 });
      show(fails >= MAX_FAILS ? 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.' : 'Username atau password salah.');
    } catch {
      show('Browser ini tidak mendukung login (butuh HTTPS atau localhost).');
    } finally {
      submit.disabled = false;
      pass.value = '';
    }
  });
  return form;
}

// ---------- dashboard ----------

function publishGuide(id) {
  return h('details', { class: 'panel' },
    h('summary', null, 'Cara menerbitkan perubahan agar terlihat publik'),
    h('ol', { class: 'steps' },
      h('li', null, 'Unduh file event (', h('code', null, `${id ?? '<id-event>'}.json`), ') dan simpan ke folder ', h('code', null, 'data/events/'), ' di repo (timpa file lama).'),
      h('li', null, 'Unduh ', h('code', null, 'index.json'), ' dan simpan sebagai ', h('code', null, 'data/index.json'), '.'),
      h('li', null, 'Commit lalu push: ', h('code', null, 'git add data && git commit -m "Update data" && git push'), '. GitHub Pages memperbarui situs dalam ±1–2 menit.')),
    h('p', { class: 'hint' }, 'Sebelum diterbitkan, perubahan hanya ada di browser ini.'));
}

function downloadIndex(pub) {
  download('index.json', buildIndex(allIds(pub)));
}

export async function renderDashboard({ rerender }) {
  const pub = await loadPublished();
  const ids = allIds(pub);
  const evs = ids.map((id) => working(id, pub)).filter(Boolean)
    .sort((a, b) => (a.end_date < b.end_date ? 1 : a.end_date > b.end_date ? -1 : a.name.localeCompare(b.name)));

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  // pembacaan file bersifat async, jadi tidak lewat act()
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      if (f.size > 5 * 1024 * 1024) throw new UserError('Ukuran file terlalu besar.');
      const ev = parseEventJSON(await f.text());
      if (adminEvents().has(ev.id) && !confirm(`Event "${ev.id}" sudah ada di browser ini. Timpa dengan isi file?`)) return;
      saveAdminEvent(ev);
      flash('ok', `Event "${ev.name}" diimpor dari file.`);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      flash('err', `Impor gagal: ${e.message}`);
    }
    rerender();
  };

  return [
    h('div', { class: 'row between' }, h('h1', null, 'Dashboard Admin')),
    isPersistent() ? null : h('div', { class: 'flash warn', role: 'alert' }, 'Penyimpanan browser tidak tersedia (mode privat?). Perubahan akan hilang saat halaman ditutup — unduh file JSON sebelum keluar.'),
    pub.errors.length ? h('div', { class: 'flash warn' }, `Event terbit yang gagal dimuat: ${pub.errors.map((e) => `${e.id} (${e.message})`).join('; ')}.`) : null,
    h('div', { class: 'row', style: 'margin-bottom:16px' },
      h('a', { class: 'btn primary', href: '#/admin/new' }, 'Event baru'),
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Impor file event (.json)'),
      h('button', { class: 'btn', type: 'button', onclick: () => downloadIndex(pub) }, 'Unduh index.json'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { await loadPublished(true); rerender(); } }, 'Muat ulang data terbit'),
      fileInput),
    publishGuide(null),
    evs.length ? evs.map((ev) => {
      const ps = publishState(ev.id, pub);
      const s = summary(ev);
      const manual = closedManually(ev);
      return h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('h2', { style: 'margin:0' }, ev.name),
          h('span', { class: 'row' }, stateChip(ev), manual ? h('span', { class: 'chip' }, 'Ditutup manual') : null, h('span', { class: `chip ${ps.cls}` }, ps.label))),
        h('p', { class: 'muted small', style: 'margin:8px 0' }, `${periodText(ev)} · ${s.total} entri (${s.pending} menunggu, ${s.valid} valid, ${s.invalid} tidak valid)`),
        h('div', { class: 'row' },
          h('a', { class: 'btn sm primary', href: `#/admin/e/${ev.id}` }, 'Kelola & verifikasi'),
          manual
            ? h('button', { class: 'btn sm', type: 'button', onclick: () => toggleClose(ev, pub, rerender) }, 'Buka kembali')
            : h('button', { class: 'btn sm danger', type: 'button', onclick: () => toggleClose(ev, pub, rerender) }, 'Tutup event')));
    }) : h('div', { class: 'card empty' }, 'Belum ada event. Klik "Event baru" untuk memulai.'),
  ];
}

function toggleClose(ev, pub, rerender) {
  const manual = closedManually(ev);
  if (!manual && !confirm(`Tutup event "${ev.name}"? Event hilang dari beranda dan tidak menerima entri baru.`)) return;
  act(rerender, () => {
    const next = mutate(ev.id, pub, (cur) => (manual ? reopenEvent(cur) : closeEvent(cur, getSession()?.u ?? 'admin')));
    if (!manual) flash('ok', `Event "${ev.name}" ditutup. Terbitkan agar berlaku untuk publik.`);
    else if (eventState(next, today()) === 'closed') flash('warn', `Event dibuka kembali, tetapi tanggal selesai (${dateID(next.end_date)}) sudah lewat sehingga tetap ditutup. Ubah tanggal lewat "Edit info".`);
    else flash('ok', `Event "${ev.name}" dibuka kembali. Terbitkan agar berlaku untuk publik.`);
  });
}

// ---------- form event ----------

export async function renderEventForm(id) {
  const pub = await loadPublished();
  const editing = id ? working(id, pub) : null;
  if (id && !editing) return notFound('Event tidak ditemukan.');

  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', id: 'e-name', maxlength: '100', required: true, value: editing?.name ?? '' });
  const start = h('input', { type: 'date', id: 'e-start', required: true, value: editing?.start_date ?? today() });
  const end = h('input', { type: 'date', id: 'e-end', required: true, value: editing?.end_date ?? '' });
  const desc = h('textarea', { id: 'e-desc', maxlength: '1000' });
  desc.value = editing?.description ?? '';

  const form = h('form', { class: 'card', novalidate: true },
    h('h1', null, editing ? 'Edit event' : 'Event baru'),
    err,
    field('Nama event', name, null, 'e-name'),
    h('div', { class: 'fields-2' },
      field('Tanggal mulai input', start, 'Inklusif.', 'e-start'),
      field('Tanggal selesai input', end, 'Inklusif. Setelah tanggal ini event otomatis tertutup.', 'e-end')),
    field('Deskripsi / info rekening', desc, 'Ditampilkan di halaman event (publik).', 'e-desc'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Simpan'),
      h('a', { class: 'btn', href: editing ? `#/admin/e/${editing.id}` : '#/admin' }, 'Batal')));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const input = { name: name.value, description: desc.value, start_date: start.value, end_date: end.value };
      const saved = editing
        ? updateEventInfo(editing, input)
        : newEvent(input, allIds(pub));
      saveAdminEvent(saved);
      flash('ok', editing ? 'Info event disimpan di browser ini. Terbitkan agar terlihat publik.' : 'Event dibuat di browser ini. Terbitkan agar terlihat publik.');
      go(`#/admin/e/${saved.id}`);
    } catch (x) {
      if (!(x instanceof UserError)) throw x;
      err.textContent = x.message;
      err.hidden = false;
    }
  });
  return form;
}

// ---------- verifikasi event ----------

const view = { status: 'all', sort: 'transfer', dir: 'asc' };

function select(id, label, value, options, onchange) {
  const el = h('select', { id, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  return h('div', null, h('label', { for: id, class: 'small' }, label), el);
}

function entryRow(ev, e, dups, pub, rerender) {
  const note = h('input', { type: 'text', maxlength: '200', value: e.admin_note, placeholder: 'Catatan (tampil publik bila tidak valid)', 'aria-label': `Catatan untuk ${e.name}` });
  const setTo = (status) => act(rerender, () => { mutate(ev.id, pub, (cur) => setStatus(cur, e.id, status, note.value)); });
  const btn = (status, text, cls) => h('button', { class: `btn sm ${cls}`, type: 'button', onclick: () => setTo(status) }, text);
  return h('tr', null,
    h('td', { 'data-label': 'Nama' }, h('strong', null, e.name),
      dups.has(e.id) ? h('span', { class: 'chip warn', style: 'margin-left:6px' }, 'mungkin ganda') : null,
      outsidePeriod(ev, e, tz) ? h('span', { class: 'chip warn', style: 'margin-left:6px' }, 'dikirim di luar periode') : null),
    h('td', { class: 'num', 'data-label': 'Nominal' }, rupiah(e.amount)),
    h('td', { class: 'nowrap', 'data-label': 'Tgl transfer' }, dateID(e.transfer_date)),
    h('td', { class: 'nowrap', 'data-label': 'Diinput' }, dateTimeID(e.submitted_at, tz)),
    h('td', { 'data-label': 'Status' }, statusChip(e.status)),
    h('td', null, h('div', { class: 'verify-controls' }, note,
      h('div', { class: 'btns' },
        btn('valid', '✓ Valid', 'ok'),
        btn('invalid', '✗ Tidak valid', 'danger'),
        btn('pending', 'Menunggu', ''),
        h('button', {
          class: 'btn sm danger', type: 'button', 'aria-label': `Hapus entri ${e.name}`,
          onclick: () => { if (confirm(`Hapus entri ${e.name} (${rupiah(e.amount)})? Tindakan ini tidak bisa dibatalkan.`)) act(rerender, () => { mutate(ev.id, pub, (cur) => deleteEntry(cur, e.id)); }); },
        }, 'Hapus')))));
}

function importPanel(ev, pub, rerender) {
  const box = h('textarea', { id: 'imp', placeholder: 'Tempel pesan/kode kirim dari peserta di sini. Boleh banyak sekaligus; teks lain di sekitarnya diabaikan.' });
  const run = () => {
    if (!box.value.trim()) { flash('err', 'Tempel minimal satu kode kirim.'); rerender(); return; }
    act(rerender, () => {
      const r = importCodes(working(ev.id, pub), box.value);
      if (r.added) saveAdminEvent(r.event);
      const parts = [`${r.added} entri ditambahkan`];
      if (r.duplicate) parts.push(`${r.duplicate} sudah ada`);
      if (r.wrongEvent) parts.push(`${r.wrongEvent} untuk event lain`);
      if (r.invalid) parts.push(`${r.invalid} kode rusak`);
      if (r.full) parts.push(`${r.full} ditolak (batas entri tercapai)`);
      flash(r.added ? 'ok' : 'warn', parts.join(', ') + '.');
    });
  };
  return h('details', { class: 'panel', open: true },
    h('summary', null, 'Impor kode kirim dari peserta'),
    field('Kode kirim', box, null, 'imp'),
    h('button', { class: 'btn primary', type: 'button', onclick: run }, 'Impor'));
}

function manualPanel(ev, pub, rerender) {
  const name = h('input', { type: 'text', id: 'm-name', maxlength: '80' });
  const amount = h('input', { type: 'text', id: 'm-amount', inputmode: 'numeric' });
  const date = h('input', { type: 'date', id: 'm-date', max: today(), value: today() });
  return h('details', { class: 'panel' },
    h('summary', null, 'Tambah entri manual (mis. dari mutasi rekening)'),
    h('div', { class: 'fields-2' }, field('Nama', name, null, 'm-name'), field('Nominal (Rp)', amount, null, 'm-amount')),
    field('Tanggal transfer', date, null, 'm-date'),
    h('button', { class: 'btn', type: 'button', onclick: () => act(rerender, () => {
      mutate(ev.id, pub, (cur) => {
        const e = newEntry({ name: name.value, amount: amount.value, transfer_date: date.value }, today());
        return { ...cur, entries: [...cur.entries, e] };
      });
      flash('ok', 'Entri ditambahkan.');
    }) }, 'Tambah'));
}

export async function renderAdminEvent(id, { rerender }) {
  const pub = await loadPublished();
  const ev = working(id, pub);
  if (!ev) return notFound('Event tidak ditemukan.');
  const ps = publishState(id, pub);
  const manual = closedManually(ev);
  const s = summary(ev);
  const dups = duplicates(ev);
  let list = ev.entries;
  if (view.status !== 'all') list = list.filter((e) => e.status === view.status);
  list = sortEntries(list, view.sort, view.dir);
  const set = (k) => (v) => { view[k] = v; rerender(); };

  const publishCard = h('div', { class: 'card' },
    h('div', { class: 'row between' }, h('h2', { style: 'margin:0' }, 'Penerbitan'), h('span', { class: `chip ${ps.cls}` }, ps.label)),
    h('p', { class: 'muted small', style: 'margin:8px 0' }, 'Publik hanya melihat file yang sudah di-commit ke repo. Perubahan Anda tersimpan di browser ini sampai diterbitkan.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => download(`${ev.id}.json`, serializeEvent(ev)) }, `Unduh ${ev.id}.json`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => downloadIndex(pub) }, 'Unduh index.json'),
      ps.key === 'dirty' && pub.byId.has(id)
        ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => {
          if (!confirm('Buang perubahan di browser ini dan kembali ke versi terbit?')) return;
          removeAdminEvent(id); flash('ok', 'Kembali ke versi terbit.'); rerender();
        } }, 'Buang perubahan lokal') : null),
    publishGuide(ev.id));

  return [
    h('p', null, h('a', { href: '#/admin' }, '← Dashboard')),
    h('div', { class: 'row between' }, h('h1', null, ev.name), h('span', { class: 'row' }, stateChip(ev), manual ? h('span', { class: 'chip' }, 'Ditutup manual') : null)),
    h('p', { class: 'muted' }, `Periode input: ${periodText(ev)} · id: ${ev.id}`),
    ev.description ? h('div', { class: 'card pre' }, ev.description) : null,
    h('div', { class: 'row', style: 'margin-bottom:16px' },
      h('a', { class: 'btn sm', href: `#/admin/e/${ev.id}/edit` }, 'Edit info'),
      manual
        ? h('button', { class: 'btn sm', type: 'button', onclick: () => toggleClose(ev, pub, rerender) }, 'Buka kembali')
        : h('button', { class: 'btn sm danger', type: 'button', onclick: () => toggleClose(ev, pub, rerender) }, 'Tutup event'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => download(`${ev.id}.csv`, toCSV(ev, tz), 'text/csv;charset=utf-8') }, 'Unduh CSV'),
      h('a', { class: 'btn sm', href: `#/e/${ev.id}` }, 'Lihat halaman publik')),
    publishCard,
    statsStrip(s),
    importPanel(ev, pub, rerender),
    manualPanel(ev, pub, rerender),
    h('div', { class: 'card' },
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        select('f-status', 'Status', view.status, [['all', 'Semua'], ...STATUSES.map((x) => [x, statusLabel(x)])], set('status')),
        select('f-sort', 'Urutkan', view.sort, [['transfer', 'Tgl transfer (sesuai mutasi)'], ['submitted', 'Waktu input'], ['name', 'Nama'], ['amount', 'Nominal']], set('sort')),
        select('f-dir', 'Arah', view.dir, [['asc', 'Naik'], ['desc', 'Turun']], set('dir'))),
      list.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
          h('thead', null, h('tr', null, ['Nama', 'Nominal', 'Tgl transfer', 'Diinput', 'Status', 'Verifikasi'].map((t) => h('th', { class: t === 'Nominal' ? 'num' : '' }, t)))),
          h('tbody', null, list.map((e) => entryRow(ev, e, dups, pub, rerender)))))
        : h('div', { class: 'empty' }, ev.entries.length ? 'Tidak ada entri dengan filter ini.' : 'Belum ada entri. Impor kode kirim dari peserta atau tambah manual.')),
  ];
}
