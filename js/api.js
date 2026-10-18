// Memuat data event dari backend (Supabase atau server Node.js).
import { normalizeEvent, UserError } from './core.js';
import { liveApi } from './mode.js';

const byEnd = (a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : a.name.localeCompare(b.name));

/** @returns {{events: object[], byId: Map, errors: {id:string,message:string}[], today: string|null}} */
export async function fetchPublished() {
  const data = await liveApi('GET', 'events');
  const events = [];
  const errors = [];
  for (const raw of Array.isArray(data.events) ? data.events : []) {
    try { events.push(normalizeEvent(raw)); } catch (e) {
      errors.push({ id: String(raw?.id ?? '?'), message: e instanceof UserError ? e.message : 'rusak' });
    }
  }
  events.sort(byEnd);
  return { events, byId: new Map(events.map((e) => [e.id, e])), errors, today: typeof data.today === 'string' ? data.today : null };
}
