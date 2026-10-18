// Memuat data event yang sudah diterbitkan (file statis di data/ pada GitHub Pages).
import { parseIndex, parseEventJSON, UserError } from './core.js';

const BASE = 'data/';

function bust() {
  // CDN GitHub Pages men-cache ±10 menit; parameter per-menit membatasi basi-nya ≤ 1 menit.
  return `?v=${Math.floor(Date.now() / 60000)}`;
}

async function getText(path) {
  const res = await fetch(BASE + path + bust(), { cache: 'no-store', credentials: 'omit' });
  if (res.status === 404) return null;
  if (!res.ok) throw new UserError(`Gagal memuat ${path} (HTTP ${res.status}).`);
  return res.text();
}

/** @returns {{events: object[], byId: Map, errors: {id:string,message:string}[], missing: boolean}} */
export async function fetchPublished() {
  let idxText;
  try { idxText = await getText('index.json'); } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError('Tidak dapat memuat data. Periksa koneksi internet Anda.');
  }
  if (idxText === null) return { events: [], byId: new Map(), errors: [], missing: true };

  const ids = parseIndex(idxText);
  const events = [];
  const errors = [];
  await Promise.all(ids.map(async (id) => {
    try {
      const text = await getText(`events/${id}.json`);
      if (text === null) throw new UserError('file tidak ditemukan');
      const ev = parseEventJSON(text);
      if (ev.id !== id) throw new UserError('id di dalam file tidak cocok dengan nama file');
      events.push(ev);
    } catch (e) {
      errors.push({ id, message: e instanceof UserError ? e.message : 'gagal dimuat' });
    }
  }));
  events.sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : a.name.localeCompare(b.name)));
  return { events, byId: new Map(events.map((e) => [e.id, e])), errors, missing: false };
}
