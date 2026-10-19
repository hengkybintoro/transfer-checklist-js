// Pemilih tanggal berbentuk kalender (tanpa dependensi, tanpa style inline sehingga lolos CSP).
// Nilai selalu berupa tanggal ISO "YYYY-MM-DD". Pekan dimulai Senin; label berbahasa Inggris.
import {
  isDate, formatDate, dateLong, MONTHS_LONG, WEEKDAYS_SHORT, monthGrid, addDays, addMonths, parseDateParts, makeDate,
} from './core.js';
import { h, clear } from './dom.js';

/**
 * @param {object} o
 * @param {string} o.id            id untuk kolom tampilan (dipakai <label for>)
 * @param {string} [o.value]       tanggal awal (ISO) atau ''
 * @param {() => string} [o.min]   batas paling awal yang boleh dipilih (dibaca setiap kali kalender dibuka)
 * @param {() => string} [o.max]
 * @param {() => string|null} [o.range]  mengembalikan tanggal ISO lawan untuk menyorot rentang; mis. tanggal mulai
 * @param {() => string} o.today   tanggal hari ini (ISO)
 * @param {(v: string) => void} [o.onchange]
 * @returns {{ el: HTMLElement, value: string }}
 */
export function datePicker({ id, value = '', min = () => '', max = () => '', range = () => null, today, onchange = () => {} }) {
  let current = isDate(value) ? value : '';
  let view = { y: 0, m: 0 };
  let focusIso = '';
  let isOpen = false;

  const field = h('input', {
    type: 'text', id, class: 'dp-field', readonly: true, autocomplete: 'off', placeholder: 'Select a date',
    role: 'combobox', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': `${id}-pop`,
  });
  const pop = h('div', { class: 'dp-pop', id: `${id}-pop`, role: 'dialog', 'aria-label': 'Select a date', hidden: true });
  const wrap = h('div', { class: 'dp' }, field, pop);

  const paint = () => { field.value = current ? formatDate(current) : ''; };
  paint();

  const inBounds = (iso) => {
    const lo = min();
    const hi = max();
    return !(lo && iso < lo) && !(hi && iso > hi);
  };

  function setView(iso) {
    const [y, m] = parseDateParts(iso);
    view = { y, m };
  }

  function choose(iso) {
    if (!inBounds(iso)) return;
    current = iso;
    paint();
    close(true);
    onchange(iso);
  }

  function render(focusSelector) {
    clear(pop);
    const t = today();
    const lo = min();
    const rangeOther = range();
    const [ty] = parseDateParts(t);
    const yFrom = Math.min(view.y, ty - 1);
    const yTo = Math.max(view.y, ty + 5);
    const years = [];
    for (let y = yFrom; y <= yTo; y++) years.push(y);

    const go = (n, sel) => { setView(addMonths(makeDate(view.y, view.m, 1), n)); render(sel); };
    const monthSel = h('select', { class: 'dp-month', 'aria-label': 'Month', onchange: (e) => { view.m = Number(e.target.value); render('.dp-month'); } },
      MONTHS_LONG.map((name, i) => h('option', { value: String(i + 1), selected: i + 1 === view.m }, name)));
    const yearSel = h('select', { class: 'dp-year', 'aria-label': 'Year', onchange: (e) => { view.y = Number(e.target.value); render('.dp-year'); } },
      years.map((y) => h('option', { value: String(y), selected: y === view.y }, String(y))));

    // sel yang boleh difokuskan lewat Tab: tanggal terfokus, bila tidak terlihat di bulan ini pakai tanggal pertama yang boleh dipilih
    const grid = monthGrid(view.y, view.m);
    const all = grid.flat().filter(Boolean);
    const tabTarget = all.includes(focusIso) && inBounds(focusIso) ? focusIso
      : (all.includes(current) && inBounds(current) ? current : (all.includes(t) && inBounds(t) ? t : all.find(inBounds)));

    const [rLo, rHi] = rangeOther && current ? [rangeOther, current].sort() : [null, null];
    const dayBtn = (iso) => {
      const cls = ['dp-day'];
      if (iso === current) cls.push('selected');
      if (iso === t) cls.push('today');
      if (rLo && iso > rLo && iso < rHi) cls.push('inrange');
      if (rangeOther && iso === rangeOther && iso !== current) cls.push('edge');
      return h('button', {
        type: 'button', class: cls.join(' '), 'data-date': iso, disabled: !inBounds(iso),
        tabindex: iso === tabTarget ? '0' : '-1', 'aria-label': dateLong(iso), 'aria-pressed': iso === current ? 'true' : 'false',
        onclick: () => choose(iso),
        onkeydown: (e) => onDayKey(e, iso),
      }, String(parseDateParts(iso)[2]));
    };

    pop.appendChild(h('div', { class: 'dp-head' },
      h('button', { type: 'button', class: 'dp-nav dp-prev', 'aria-label': 'Previous month', onclick: () => go(-1, '.dp-prev') }, '‹'),
      monthSel, yearSel,
      h('button', { type: 'button', class: 'dp-nav dp-next', 'aria-label': 'Next month', onclick: () => go(1, '.dp-next') }, '›')));
    pop.appendChild(h('div', { class: 'dp-grid', role: 'grid' },
      WEEKDAYS_SHORT.map((d) => h('div', { class: 'dp-dow', 'aria-hidden': 'true' }, d)),
      grid.flat().map((iso) => (iso ? dayBtn(iso) : h('span', { class: 'dp-blank' })))));
    pop.appendChild(h('div', { class: 'dp-foot' },
      h('button', { type: 'button', class: 'btn sm dp-today', disabled: !inBounds(t), onclick: () => choose(t) }, 'Today'),
      h('button', { type: 'button', class: 'btn sm dp-close', onclick: () => close(true) }, 'Close')));

    if (lo && !all.some(inBounds)) pop.appendChild(h('p', { class: 'hint' }, `Choose ${formatDate(lo)} or later.`));
    if (focusSelector) pop.querySelector(focusSelector)?.focus();
  }

  function moveFocus(iso) {
    if (!isDate(iso) || !inBounds(iso)) return;
    focusIso = iso;
    setView(iso);
    render(`[data-date="${iso}"]`);
  }

  function onDayKey(e, iso) {
    const [y, m, d] = parseDateParts(iso);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = Senin
    const moves = {
      ArrowLeft: () => addDays(iso, -1), ArrowRight: () => addDays(iso, 1), ArrowUp: () => addDays(iso, -7), ArrowDown: () => addDays(iso, 7),
      PageUp: () => addMonths(iso, -1), PageDown: () => addMonths(iso, 1),
      Home: () => addDays(iso, -dow), End: () => addDays(iso, 6 - dow),
    };
    if (e.key === 'Tab') { close(false); return; }
    if (!moves[e.key]) return;
    e.preventDefault();
    moveFocus(moves[e.key]());
  }

  function place() {
    pop.classList.remove('right');
    const r = pop.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) pop.classList.add('right');
  }

  function onOutside(e) { if (!wrap.contains(e.target)) close(false); }
  function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(true); } }

  function open() {
    if (isOpen) return;
    isOpen = true;
    const t = today();
    focusIso = current || (inBounds(t) ? t : min() || t);
    setView(current || min() || t);
    pop.hidden = false;
    field.setAttribute('aria-expanded', 'true');
    render(null);
    place();
    pop.querySelector('.dp-day[tabindex="0"]')?.focus();
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
  }

  function close(returnFocus) {
    if (!isOpen) return;
    isOpen = false;
    pop.hidden = true;
    field.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
    if (returnFocus) field.focus();
  }

  field.addEventListener('click', () => (isOpen ? close(true) : open()));
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); }
  });

  return {
    el: wrap,
    get value() { return current; },
    set value(v) { current = isDate(v) ? v : ''; paint(); },
  };
}
