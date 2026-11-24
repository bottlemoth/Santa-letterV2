import { api, setUnauthorizedHandler, resetCsrf } from './api.js';
import { h, clear, icon } from './dom.js';
import { toast, errorState } from './ui.js';
import { state } from './state.js';
import { homeView, loginView, registerView } from './views/auth.js';
import { dashboardView } from './views/dashboard.js';
import { groupsView, groupDetailView, joinView } from './views/groups.js';
import { myListsView, listFormView, userListsView } from './views/lists.js';
import { listView } from './views/listView.js';
import { notificationsView } from './views/notifications.js';
import { profileView } from './views/profile.js';

// ---------- routing (hash) ----------

const routes = [
  { path: '/', view: homeView, guest: true },
  { path: '/login', view: loginView, guest: true },
  { path: '/register', view: registerView, guest: true },
  { path: '/dashboard', view: dashboardView, auth: true },
  { path: '/groups', view: groupsView, auth: true },
  { path: '/groups/:id', view: groupDetailView, auth: true },
  { path: '/join', view: joinView, auth: true },
  { path: '/join/:code', view: joinView, auth: true },
  { path: '/lists', view: myListsView, auth: true },
  { path: '/lists/new', view: listFormView, auth: true },
  { path: '/lists/:id/edit', view: listFormView, auth: true },
  { path: '/lists/:id', view: listView, auth: true },
  { path: '/users/:id', view: userListsView, auth: true },
  { path: '/notifications', view: notificationsView, auth: true },
  { path: '/profile', view: profileView, auth: true },
];

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const r of routes) {
    const rp = r.path.split('/').filter(Boolean);
    if (rp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i += 1) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (rp[i] !== parts[i]) ok = false;
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export function navigate(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const main = document.getElementById('main');
  const m = match(path);

  if (!m) {
    clear(main).append(
      h('section', { class: 'empty-state' }, h('h1', { tabindex: '-1' }, 'Nie znaleziono strony'), h('p', {}, 'Ta strona nie istnieje.'), h('a', { class: 'btn btn-primary', href: '#/' }, 'Wróć na start')),
    );
    focusHeading(main);
    return;
  }
  if (m.route.auth && !state.user) {
    sessionStorage.setItem('afterLogin', path);
    navigate('/login');
    return;
  }
  if (m.route.guest && state.user) {
    navigate('/dashboard');
    return;
  }

  renderNav(path);
  clear(main).append(h('p', { class: 'loading', role: 'status' }, 'Ładowanie…'));
  try {
    const node = await m.route.view(m.params);
    if (seq !== renderSeq) return; // użytkownik przeszedł już dalej
    clear(main).append(node);
  } catch (err) {
    if (seq !== renderSeq) return;
    clear(main).append(errorState(err));
  }
  focusHeading(main);
  window.scrollTo(0, 0);
}

function focusHeading(main) {
  const h1 = main.querySelector('h1');
  if (h1) {
    h1.setAttribute('tabindex', '-1');
    h1.focus({ preventScroll: true });
    document.title = `${h1.textContent} · Santa Letter`;
  }
}

// ---------- nawigacja ----------

function navLink(href, label, current, extra) {
  // Podświetlamy tylko dokładne dopasowanie i podstrony grup (cudza lista to nie „Moje listy”).
  const target = href.slice(1);
  const isCurrent = current === target || (target === '/groups' && current.startsWith('/groups/')) || (target === '/lists' && current === '/lists/new');
  return h('a', { href, class: 'nav-link', 'aria-current': isCurrent ? 'page' : null }, label, extra || null);
}

export function renderNav(current = (location.hash.replace(/^#/, '') || '/')) {
  const nav = document.getElementById('site-nav');
  const toggle = document.querySelector('.nav-toggle');
  clear(nav);
  if (!state.user) {
    toggle.hidden = true;
    nav.append(navLink('#/login', 'Zaloguj się', current), h('a', { href: '#/register', class: 'btn btn-gold btn-sm' }, 'Załóż konto'));
    return;
  }
  toggle.hidden = false;
  const badgeEl = state.unread > 0 ? h('span', { class: 'nav-badge', 'aria-label': `${state.unread} nieprzeczytanych` }, String(state.unread)) : null;
  const logout = h('button', { type: 'button', class: 'nav-link nav-button' }, 'Wyloguj');
  logout.addEventListener('click', async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      state.user = null;
      state.unread = 0;
      resetCsrf();
      toast('Wylogowano. Do zobaczenia!');
      navigate('/');
    }
  });
  nav.append(
    navLink('#/dashboard', 'Pulpit', current),
    navLink('#/lists', 'Moje listy', current),
    navLink('#/groups', 'Grupy', current),
    navLink('#/notifications', 'Powiadomienia', current, badgeEl),
    navLink('#/profile', state.user.name, current),
    logout,
  );
}

function setupNavToggle() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    nav.classList.toggle('open', !open);
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) {
      toggle.setAttribute('aria-expanded', 'false');
      nav.classList.remove('open');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      toggle.setAttribute('aria-expanded', 'false');
      nav.classList.remove('open');
      toggle.focus();
    }
  });
}

export async function refreshUnread() {
  if (!state.user) return;
  try {
    const { unreadCount } = await api.get('/notifications/unread-count');
    if (unreadCount !== state.unread) {
      state.unread = unreadCount;
      renderNav();
    }
  } catch {
    /* ignorujemy — badge jest pomocniczy */
  }
}

// ---------- start ----------

async function boot() {
  setupNavToggle();
  setUnauthorizedHandler(() => {
    if (state.user) {
      state.user = null;
      toast('Sesja wygasła. Zaloguj się ponownie.', 'error');
      navigate('/login');
    }
  });
  try {
    const { user } = await api.get('/auth/me');
    state.user = user;
  } catch {
    state.user = null;
  }
  state.onAuthChange = () => {
    renderNav();
    refreshUnread();
  };
  window.addEventListener('hashchange', render);
  await render();
  refreshUnread();
  setInterval(refreshUnread, 60000);
}

// Udostępniamy nawigację widokom bez cyklicznych importów.
state.navigate = navigate;
state.refreshUnread = refreshUnread;

boot();

// Drobny akcent: ikona w stopce (nie wpływa na treść).
document.querySelector('.site-footer p')?.prepend(icon('star'), ' ');
