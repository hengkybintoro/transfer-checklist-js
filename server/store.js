// Penyimpanan file JSON: satu file per event di <data_dir>/events/<id>.json.
// Penulisan atomik (tulis .tmp -> fsync -> rename) dan cadangan .bak; kunci per event agar tidak saling timpa.
import { mkdir, readdir, readFile, writeFile, rename, copyFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { normalizeEvent, serializeEvent, newEvent, validId, buildIndex, UserError } from '../js/core.js';

export class NotFoundError extends UserError {}

export class Store {
  constructor(dir, { log = () => {} } = {}) {
    this.dir = dir;
    this.eventsDir = path.join(dir, 'events');
    this.log = log;
    this.chains = new Map();
  }

  async init() {
    await mkdir(this.eventsDir, { recursive: true });
  }

  file(id) {
    if (!validId(id)) throw new NotFoundError('Event tidak ditemukan.');
    return path.join(this.eventsDir, `${id}.json`);
  }

  /** Menjalankan fn secara berurutan per kunci (mutex berbasis promise). */
  lock(key, fn) {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.chains.set(key, tail);
    tail.then(() => { if (this.chains.get(key) === tail) this.chains.delete(key); });
    return run;
  }

  async read(id) {
    let text;
    try { text = await readFile(this.file(id), 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') throw new NotFoundError('Event tidak ditemukan.');
      throw e;
    }
    const ev = normalizeEvent(JSON.parse(text));
    if (ev.id !== id) throw new Error(`id di dalam file ${id}.json tidak cocok`);
    return ev;
  }

  async get(id) {
    return this.read(id);
  }

  async ids() {
    const names = await readdir(this.eventsDir);
    return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter(validId);
  }

  async list() {
    const out = [];
    for (const id of await this.ids()) {
      try { out.push(await this.read(id)); } catch (e) { this.log(`event ${id} dilewati: ${e.message}`); }
    }
    return out.sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : a.name.localeCompare(b.name)));
  }

  async write(ev) {
    const target = this.file(ev.id);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(serializeEvent(ev), 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    try { await copyFile(target, `${target}.bak`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { await rename(tmp, target); } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
  }

  /** Baca-ubah-tulis atomik. fn menerima salinan event dan mengembalikan event baru (atau melempar). */
  update(id, fn) {
    return this.lock(id, async () => {
      const cur = await this.read(id);
      const next = await fn(structuredClone(cur));
      const clean = normalizeEvent(next);
      await this.write(clean);
      return clean;
    });
  }

  create(input, now = new Date()) {
    return this.lock('__create__', async () => {
      const ids = await this.ids();
      const ev = newEvent(input, ids, now);
      await this.write(ev);
      await this.writeIndex();
      return ev;
    });
  }

  /** Menjaga data/index.json tetap sinkron agar folder data bisa dipakai juga oleh mode GitHub Pages. */
  async writeIndex() {
    const text = buildIndex(await this.ids());
    const target = path.join(this.dir, 'index.json');
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, text, { mode: 0o644 });
    await rename(tmp, target);
  }
}
