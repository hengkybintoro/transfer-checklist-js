// Router berbasis hash (#/...) supaya berjalan di GitHub Pages tanpa konfigurasi server.
import { validId, UserError } from './core.js';
import { h, clear } from './dom.js';
import { layout, notFound, errorBox, appName } from './ui.js';
import { currentSession, initSession } from './session.js';
import { renderHome, renderEvent } from './views-public.js';
import { renderLogin, renderDashboard, renderEventForm, renderAdminEvent, setAfterLogin } from './views-admin.js';

const root = document.getElementById('root');
let token = 0;
let lastHash = null;

function resolve(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b, c, d] = parts;
  if (parts.length === 0) return { title: 'Event Aktif', run: renderHome };
  if (a === 'e' && parts.length === 2 && validId(b)) return { title: 'Event', run: (ctx) => renderEvent(b, ctx) };
  if (a === 'admin') {
    if (b === 'login' && parts.length === 2) return { title: 'Login Admin', admin: true, public: true, run: async () => renderLogin() };
    if (parts.length === 1) return { title: 'Dashboard Admin', admin: true, run: renderDashboard };
    if (b === 'new' && parts.length === 2) return { title: 'Event baru', admin: true, run: () => renderEventForm(null) };
    if (b === 'e' && validId(c) && parts.length === 3) return { title: 'Verifikasi', admin: true, run: (ctx) => renderAdminEvent(c, ctx) };
    if (b === 'e' && validId(c) && d === 'edit' && parts.length === 4) return { title: 'Edit event', admin: true, run: () => renderEventForm(c) };
  }
  return { title: 'Tidak ditemukan', run: async () => notFound() };
}

function paint(content, route, keepFlash = false) {
  clear(root);
  for (const node of layout(content, { admin: route.admin, keepFlash })) root.appendChild(node);
  document.title = `${route.title} · ${appName}`;
}

async function render() {
  const mine = ++token;
  const hash = location.hash || '#/';
  const sameRoute = hash === lastHash;
  lastHash = hash;
  const route = resolve(hash);

  if (route.admin) {
    const session = currentSession();
    if (route.public) {
      if (session) { location.hash = '#/admin'; return; }
    } else if (!session) {
      setAfterLogin(hash);
      location.hash = '#/admin/login';
      return;
    }
  }

  const scrollY = sameRoute ? window.scrollY : 0;
  if (!sameRoute) paint(h('p', { class: 'muted', role: 'status' }, 'Memuat…'), route, true);

  let content;
  try {
    content = await route.run({ rerender: render });
  } catch (e) {
    content = errorBox(e instanceof UserError ? e.message : 'Terjadi kesalahan tak terduga. Muat ulang halaman.');
    if (!(e instanceof UserError)) console.error(e);
  }
  if (mine !== token) return; // navigasi lain sudah mengambil alih
  if (route.admin && !route.public && !currentSession()) { // sesi berakhir saat data dimuat
    setAfterLogin(hash);
    location.hash = '#/admin/login';
    return;
  }
  paint(content, route);
  window.scrollTo(0, scrollY);
  if (!sameRoute) document.getElementById('app')?.focus({ preventScroll: true });
}

window.addEventListener('hashchange', render);
await initSession(); // mode server: tanyakan ke server apakah sudah login
render();
