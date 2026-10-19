// Halaman admin: login, daftar event, form event, dan halaman verifikasi.
// Semua perubahan langsung ke backend (Supabase atau server Node.js) lewat liveApi.
import {
  supabaseProblem, UserError, eventState, closedManually, summary, duplicates, sortEntries, toCSV,
  rupiah, formatDate, formatDateTime, STATUSES, statusLabel,
} from './core.js';
import { h, download } from './dom.js';
import { datePicker } from './datepicker.js';
import {
  config, tz, today, loadPublished, flash, go, stateChip, statusChip, periodText, countsText, field, notFound, errorBox,
} from './ui.js';
import { isSupabase, liveApi } from './mode.js';
import { liveLogin } from './session.js';

/** Menjalankan aksi; UserError diubah menjadi pesan flash lalu halaman digambar ulang. */
async function act(rerender, fn) {
  try { await fn(); } catch (e) {
    if (!(e instanceof UserError)) throw e;
    flash('err', e.message);
  }
  rerender();
}

const entryUrl = (ev, id) => `admin/events/${ev.id}/entries${id ? `/${id}` : ''}`;
const doSetStatus = (ev, entryId, status, note) => liveApi('POST', `${entryUrl(ev, entryId)}/status`, { status, note });
const doDeleteEntry = (ev, entryId) => liveApi('DELETE', entryUrl(ev, entryId));
const doAddEntry = (ev, input) => liveApi('POST', entryUrl(ev), input);

// ---------- login ----------

let afterLogin = '#/admin';
export const setAfterLogin = (hash) => { afterLogin = typeof hash === 'string' && hash.startsWith('#/admin') && !hash.startsWith('#/admin/login') ? hash : '#/admin'; };

export function renderLogin() {
  const problem = isSupabase ? supabaseProblem(config) : '';
  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const user = h('input', { type: 'text', id: 'l-user', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const pass = h('input', { type: 'password', id: 'l-pass', name: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn primary block', type: 'submit', disabled: Boolean(problem) }, 'Sign in');
  const show = (m) => { err.textContent = m; err.hidden = false; };

  const form = h('form', { class: 'card narrow', novalidate: true },
    h('h1', null, 'Admin sign in'),
    problem ? errorBox(problem) : null,
    err,
    field('Username', user, null, 'l-user'),
    field('Password', pass, null, 'l-pass'),
    submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (problem) return;
    submit.disabled = true;
    try {
      await liveLogin(user.value.trim(), pass.value);
      const dest = afterLogin;
      afterLogin = '#/admin';
      go(dest);
    } catch (x) {
      if (!(x instanceof UserError)) throw x;
      show(x.message);
    } finally {
      submit.disabled = false;
      pass.value = '';
    }
  });
  return form;
}

// ---------- events list ----------

export async function renderDashboard() {
  const pub = await loadPublished();
  const evs = [...pub.events].sort((a, b) => (a.end_date < b.end_date ? 1 : a.end_date > b.end_date ? -1 : a.name.localeCompare(b.name)));

  return [
    h('div', { class: 'title-row between' },
      h('h1', null, 'Events'),
      h('a', { class: 'btn primary', href: '#/admin/new' }, 'New event')),
    pub.errors.length ? h('div', { class: 'flash warn' }, `Some events could not be loaded: ${pub.errors.map((e) => `${e.id} (${e.message})`).join('; ')}.`) : null,
    evs.length
      ? h('div', { class: 'list' }, evs.map((ev) => h('a', { class: 'list-item', href: `#/admin/e/${ev.id}` },
        h('span', { class: 'title-row' }, h('strong', null, ev.name), stateChip(ev)),
        h('span', { class: 'muted small' }, `${periodText(ev)} · ${countsText(summary(ev))}`))))
      : h('p', { class: 'empty' }, 'No events yet. Create one to get started.'),
  ];
}

function toggleClose(ev, rerender) {
  const manual = closedManually(ev);
  if (!manual && !confirm(`Close "${ev.name}"? It will disappear from the home page and stop accepting entries.`)) return;
  act(rerender, async () => {
    const next = (await liveApi('POST', `admin/events/${ev.id}/${manual ? 'reopen' : 'close'}`, {})).event;
    if (!manual) flash('ok', 'Event closed.');
    else if (eventState(next, today()) === 'closed') flash('warn', `Event reopened, but its end date (${formatDate(next.end_date)}) has passed, so it is still closed. Change the dates with Edit.`);
    else flash('ok', 'Event reopened.');
  });
}

// ---------- event form ----------

export async function renderEventForm(id) {
  const pub = await loadPublished();
  const editing = id ? pub.byId.get(id) ?? null : null;
  if (id && !editing) return notFound('Event not found.');

  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', id: 'e-name', maxlength: '100', required: true, value: editing?.name ?? '' });
  // Tanggal selesai tidak boleh sebelum tanggal mulai, dan ikut maju bila mulai digeser melewatinya.
  const start = datePicker({
    id: 'e-start', value: editing?.start_date ?? today(), today,
    onchange: (v) => { if (end.value && end.value < v) end.value = v; },
  });
  const end = datePicker({ id: 'e-end', value: editing?.end_date ?? '', today, min: () => start.value, range: () => start.value || null });
  const desc = h('textarea', { id: 'e-desc', maxlength: '1000' });
  desc.value = editing?.description ?? '';

  const form = h('form', { class: 'card narrow', novalidate: true },
    h('h1', null, editing ? 'Edit event' : 'New event'),
    err,
    field('Name', name, null, 'e-name'),
    h('div', { class: 'fields-2' },
      field('Start date', start.el, null, 'e-start'),
      field('End date', end.el, 'Submissions close automatically after this date.', 'e-end')),
    field('Description', desc, 'Shown on the public event page, e.g. bank account details.', 'e-desc'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('a', { class: 'btn', href: editing ? `#/admin/e/${editing.id}` : '#/admin' }, 'Cancel')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const input = { name: name.value, description: desc.value, start_date: start.value, end_date: end.value };
      const saved = (await liveApi(editing ? 'PUT' : 'POST', editing ? `admin/events/${editing.id}` : 'admin/events', input)).event;
      flash('ok', editing ? 'Event updated.' : 'Event created.');
      go(`#/admin/e/${saved.id}`);
    } catch (x) {
      if (!(x instanceof UserError)) throw x;
      err.textContent = x.message;
      err.hidden = false;
    }
  });
  return form;
}

// ---------- manage event ----------

const view = { status: 'all', sort: 'transfer-asc' };
const SORTS = [
  ['transfer-asc', 'Transfer date, oldest first', 'transfer', 'asc'],
  ['transfer-desc', 'Transfer date, newest first', 'transfer', 'desc'],
  ['submitted-desc', 'Recently submitted', 'submitted', 'desc'],
  ['name-asc', 'Name', 'name', 'asc'],
  ['amount-desc', 'Amount, highest first', 'amount', 'desc'],
];

function select(id, label, value, options, onchange) {
  const el = h('select', { id, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  return h('div', { class: 'select' }, h('label', { for: id, class: 'small muted' }, label), el);
}

function entryRow(ev, e, dups, rerender) {
  const note = h('input', { type: 'text', maxlength: '200', value: e.admin_note, placeholder: 'Note (public if invalid)', 'aria-label': `Note for ${e.name}` });
  const setTo = (status) => act(rerender, () => doSetStatus(ev, e.id, status, note.value));
  const btn = (status, cls) => h('button', { class: `btn sm ${cls}`, type: 'button', onclick: () => setTo(status) }, statusLabel(status));
  const kind = { valid: 'ok', invalid: 'danger', pending: '' };
  return h('tr', null,
    h('td', { 'data-label': 'Name' }, h('strong', null, e.name),
      dups.has(e.id) ? h('span', { class: 'chip warn' }, 'Possible duplicate') : null,
      h('div', { class: 'muted small' }, `Submitted ${formatDateTime(e.submitted_at, tz)}`)),
    h('td', { class: 'num', 'data-label': 'Amount' }, rupiah(e.amount)),
    h('td', { class: 'nowrap', 'data-label': 'Transfer date' }, formatDate(e.transfer_date)),
    h('td', { 'data-label': 'Status' }, statusChip(e.status)),
    h('td', null, h('div', { class: 'review' }, note,
      h('div', { class: 'btns' },
        STATUSES.filter((s) => s !== e.status).map((s) => btn(s, kind[s])),
        h('button', {
          class: 'btn sm quiet', type: 'button', 'aria-label': `Delete entry from ${e.name}`,
          onclick: () => { if (confirm(`Delete the entry from ${e.name} (${rupiah(e.amount)})? This cannot be undone.`)) act(rerender, () => doDeleteEntry(ev, e.id)); },
        }, 'Delete')))));
}

function manualPanel(ev, rerender) {
  const name = h('input', { type: 'text', id: 'm-name', maxlength: '80' });
  const amount = h('input', { type: 'text', id: 'm-amount', inputmode: 'numeric', placeholder: '1,500,000' });
  const date = datePicker({ id: 'm-date', value: today(), today, max: () => today() });
  return h('details', { class: 'panel' },
    h('summary', null, 'Add an entry manually'),
    h('div', { class: 'fields-3' },
      field('Name', name, null, 'm-name'),
      field('Amount (Rp)', amount, null, 'm-amount'),
      field('Transfer date', date.el, null, 'm-date')),
    h('button', { class: 'btn', type: 'button', onclick: () => act(rerender, async () => {
      await doAddEntry(ev, { name: name.value, amount: amount.value, transfer_date: date.value });
      flash('ok', 'Entry added.');
    }) }, 'Add'));
}

export async function renderAdminEvent(id, { rerender }) {
  const pub = await loadPublished();
  const ev = pub.byId.get(id);
  if (!ev) return notFound('Event not found.');
  const manual = closedManually(ev);
  const dups = duplicates(ev);
  let list = ev.entries;
  if (view.status !== 'all') list = list.filter((e) => e.status === view.status);
  const [, , by, dir] = SORTS.find((x) => x[0] === view.sort) ?? SORTS[0];
  list = sortEntries(list, by, dir);

  return [
    h('p', { class: 'back' }, h('a', { href: '#/admin' }, '← Events')),
    h('div', { class: 'title-row' }, h('h1', null, ev.name), stateChip(ev)),
    h('p', { class: 'muted' }, periodText(ev)),
    ev.description ? h('p', { class: 'description pre' }, ev.description) : null,
    h('div', { class: 'row actions' },
      h('a', { class: 'btn sm', href: `#/admin/e/${ev.id}/edit` }, 'Edit'),
      h('button', { class: `btn sm${manual ? '' : ' danger'}`, type: 'button', onclick: () => toggleClose(ev, rerender) }, manual ? 'Reopen' : 'Close'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => download(`${ev.id}.csv`, toCSV(ev, tz), 'text/csv;charset=utf-8') }, 'Export CSV')),
    h('h2', { class: 'section' }, 'Entries'),
    h('p', { class: 'muted small' }, countsText(summary(ev))),
    manualPanel(ev, rerender),
    ev.entries.length ? h('div', { class: 'filters' },
      select('f-status', 'Show', view.status, [['all', 'All'], ...STATUSES.map((x) => [x, statusLabel(x)])], (v) => { view.status = v; rerender(); }),
      select('f-sort', 'Sort by', view.sort, SORTS.map(([v, t]) => [v, t]), (v) => { view.sort = v; rerender(); })) : null,
    list.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
        h('thead', null, h('tr', null, ['Name', 'Amount', 'Transfer date', 'Status', 'Review'].map((t) => h('th', { class: t === 'Amount' ? 'num' : '' }, t)))),
        h('tbody', null, list.map((e) => entryRow(ev, e, dups, rerender)))))
      : h('p', { class: 'empty' }, ev.entries.length ? 'No entries match this filter.' : 'No entries yet. Entries submitted by participants will appear here.'),
  ];
}
