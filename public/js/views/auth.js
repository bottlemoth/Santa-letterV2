import { api, setCsrf } from '../api.js';
import { h, icon } from '../dom.js';
import { field, handleSubmit, formObject, toast } from '../ui.js';
import { state } from '../state.js';

function afterAuth(res, message) {
  setCsrf(res.csrfToken);
  state.user = res.user;
  state.onAuthChange();
  toast(message);
  const next = sessionStorage.getItem('afterLogin');
  sessionStorage.removeItem('afterLogin');
  state.navigate(next && next !== '/login' && next !== '/register' ? next : '/dashboard');
}

export function homeView() {
  const feature = (iconName, title, text) =>
    h('li', { class: 'feature' }, h('div', { class: 'feature-icon' }, icon(iconName)), h('h3', {}, title), h('p', {}, text));
  return h(
    'div',
    { class: 'home' },
    h(
      'section',
      { class: 'hero' },
      h('p', { class: 'eyebrow' }, 'Listy prezentowe dla rodziny i przyjaciół'),
      h('h1', {}, 'Prezenty, które naprawdę cieszą — i nadal zaskakują.'),
      h(
        'p',
        { class: 'lead' },
        'Twórz listy życzeń, dziel się nimi w grupach i zaklepuj prezenty dla bliskich. Nikt nie kupi dwa razy tego samego, a właściciel listy nigdy nie dowie się, co już zostało zarezerwowane.',
      ),
      h(
        'div',
        { class: 'hero-actions' },
        h('a', { class: 'btn btn-primary btn-lg', href: '#/register' }, 'Załóż darmowe konto'),
        h('a', { class: 'btn btn-ghost btn-lg', href: '#/login' }, 'Mam już konto'),
      ),
    ),
    h(
      'section',
      { 'aria-labelledby': 'how-title' },
      h('h2', { id: 'how-title', class: 'section-title' }, 'Jak to działa?'),
      h(
        'ul',
        { class: 'features' },
        feature('users', 'Grupy bliskich', 'Załóż grupę rodzinną lub znajomych i zaproś innych kodem albo linkiem.'),
        feature('gift', 'Listy na każdą okazję', 'Boże Narodzenie, urodziny, rocznica — z linkami, zdjęciami i priorytetami.'),
        feature('lock', 'Sekret zostaje sekretem', 'Zaklepane prezenty widzą wszyscy… poza osobą, która ma je dostać.'),
        feature('sparkle', 'Tryb „Niespodzianka”', 'Podaj zainteresowania i rozmiary, a bliscy sami wymyślą tajny prezent.'),
      ),
    ),
  );
}

export function loginView() {
  const form = h(
    'form',
    { class: 'card form', novalidate: true },
    field({ name: 'email', label: 'Adres e-mail', type: 'email', required: true, attrs: { autocomplete: 'email' } }),
    field({ name: 'password', label: 'Hasło', type: 'password', required: true, attrs: { autocomplete: 'current-password' } }),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Zaloguj się')),
  );
  handleSubmit(form, async (fd) => {
    const res = await api.post('/auth/login', formObject(fd));
    afterAuth(res, `Witaj ponownie, ${res.user.name}!`);
  });
  return h(
    'section',
    { class: 'auth-page' },
    h('h1', {}, 'Zaloguj się'),
    h('p', { class: 'subtitle' }, 'Miło Cię znowu widzieć.'),
    form,
    h('p', { class: 'auth-switch' }, 'Nie masz konta? ', h('a', { href: '#/register' }, 'Zarejestruj się')),
  );
}

export function registerView() {
  const form = h(
    'form',
    { class: 'card form', novalidate: true },
    field({ name: 'name', label: 'Imię lub nazwa', required: true, attrs: { autocomplete: 'name', maxlength: 80 } }),
    field({ name: 'email', label: 'Adres e-mail', type: 'email', required: true, attrs: { autocomplete: 'email' } }),
    field({
      name: 'password',
      label: 'Hasło',
      type: 'password',
      required: true,
      hint: 'Co najmniej 8 znaków.',
      attrs: { autocomplete: 'new-password', minlength: 8 },
    }),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Załóż konto')),
  );
  handleSubmit(form, async (fd) => {
    const res = await api.post('/auth/register', formObject(fd));
    afterAuth(res, `Konto utworzone. Witaj, ${res.user.name}!`);
  });
  return h(
    'section',
    { class: 'auth-page' },
    h('h1', {}, 'Załóż konto'),
    h('p', { class: 'subtitle' }, 'Kilka sekund i możesz pisać swój list do Mikołaja.'),
    form,
    h('p', { class: 'auth-switch' }, 'Masz już konto? ', h('a', { href: '#/login' }, 'Zaloguj się')),
  );
}
