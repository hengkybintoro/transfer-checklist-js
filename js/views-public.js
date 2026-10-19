// Halaman publik: beranda (event aktif) dan halaman event (form + daftar entri).
import {
  isActive, eventState, submitBlockReason, validateEntryInput, summary, sortEntries, rupiah, formatDate, UserError,
} from './core.js';
import { h } from './dom.js';
import { datePicker } from './datepicker.js';
import { today, loadPublished, stateChip, statusChip, periodLine, countsText, field, notFound, flash } from './ui.js';
import { liveApi } from './mode.js';

function pubWarnings(pub) {
  if (!pub.errors.length) return null;
  return h('div', { class: 'flash warn', role: 'status' },
    `Some events could not be loaded: ${pub.errors.map((e) => `${e.id} (${e.message})`).join('; ')}.`);
}

// ---------- home ----------

export async function renderHome() {
  const pub = await loadPublished();
  const t = today();
  const active = pub.events.filter((e) => isActive(e, t));

  const body = [h('h1', null, 'Open events'), pubWarnings(pub)];
  if (!active.length) {
    body.push(h('p', { class: 'empty' }, 'No events are open right now.'));
  } else {
    body.push(h('div', { class: 'list' }, active.map((ev) => h('a', { class: 'list-item', href: `#/e/${ev.id}` },
      h('strong', null, ev.name),
      h('span', { class: 'muted small' }, `${periodLine(ev)} · ${countsText(summary(ev))}`)))));
  }
  return body;
}

// ---------- event page ----------

function entryForm(ev, rerender) {
  const t = today();
  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', id: 'f-name', name: 'name', maxlength: '80', required: true, autocomplete: 'name' });
  const amount = h('input', { type: 'text', id: 'f-amount', name: 'amount', inputmode: 'numeric', required: true, placeholder: '1,500,000', autocomplete: 'off' });
  // Tanggal transfer dipilih dari kalender (sama seperti form event); tidak boleh melewati hari ini.
  const date = datePicker({ id: 'f-date', value: t, today, max: () => today() });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Submit');
  const form = h('form', { novalidate: true, class: 'card' },
    h('h2', null, 'Log a transfer'),
    h('p', { class: 'muted small' }, 'An admin checks each entry against the bank statement.'),
    err,
    field('Name', name, 'As shown on the bank statement.', 'f-name'),
    h('div', { class: 'fields-2' },
      field('Amount (Rp)', amount, null, 'f-amount'),
      field('Transfer date', date.el, null, 'f-date')),
    submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      const reason = submitBlockReason(ev, today());
      if (reason) throw new UserError(reason);
      validateEntryInput({ name: name.value, amount: amount.value, transfer_date: date.value }, today());
      // database memeriksa ulang semua aturan (periode memakai jam server)
      await liveApi('POST', `events/${ev.id}/entries`, { name: name.value, amount: amount.value, transfer_date: date.value });
      flash('ok', 'Entry submitted. It stays Pending until an admin verifies it.');
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
  if (!ev.entries.length) return h('p', { class: 'empty' }, 'No entries yet.');
  const rows = sortEntries(ev.entries, 'submitted', 'desc').map((e) => h('tr', null,
    h('td', { 'data-label': 'Name' }, h('strong', null, e.name)),
    h('td', { class: 'num', 'data-label': 'Amount' }, rupiah(e.amount)),
    h('td', { class: 'nowrap', 'data-label': 'Transfer date' }, formatDate(e.transfer_date)),
    h('td', { 'data-label': 'Status' }, statusChip(e.status),
      e.status === 'invalid' && e.admin_note ? h('div', { class: 'note' }, e.admin_note) : null)));
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'stack' },
      h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', { class: 'num' }, 'Amount'), h('th', null, 'Transfer date'), h('th', null, 'Status'))),
      h('tbody', null, rows)));
}

export async function renderEvent(id, { rerender }) {
  const pub = await loadPublished();
  const ev = pub.byId.get(id);
  if (!ev) {
    return notFound(pub.errors.some((e) => e.id === id) ? 'This event could not be loaded. Please try again later.' : 'Event not found.');
  }
  const t = today();
  const state = eventState(ev, t);
  const reason = submitBlockReason(ev, t);

  return [
    h('p', { class: 'back' }, h('a', { href: '#/' }, '← Events')),
    h('div', { class: 'title-row' }, h('h1', null, ev.name), state === 'open' ? null : stateChip(ev)),
    h('p', { class: 'muted' }, periodLine(ev)),
    ev.description ? h('p', { class: 'description pre' }, ev.description) : null,
    state === 'open' ? entryForm(ev, rerender) : h('div', { class: 'flash warn', role: 'status' }, reason),
    h('h2', { class: 'section' }, 'Entries'),
    h('p', { class: 'muted small' }, countsText(summary(ev))),
    entriesTable(ev),
  ];
}
