import { api } from '../api.js';
import { h, icon } from '../dom.js';
import { pageHeader, emptyState, occasionLabel, formatDate, daysUntil, badge } from '../ui.js';
import { state } from '../state.js';

export function listCard(list, { showOwner = false } = {}) {
  const days = daysUntil(list.eventDate);
  const when =
    list.eventDate &&
    h(
      'p',
      { class: 'meta' },
      icon('calendar'),
      ' ',
      formatDate(list.eventDate),
      days !== null && days >= 0 && days <= 30 ? h('span', { class: 'soon' }, days === 0 ? ' · dziś!' : ` · za ${days} dni`) : null,
    );
  return h(
    'li',
    { class: 'card list-card' },
    h(
      'div',
      { class: 'list-card-top' },
      badge(occasionLabel(list), list.occasion),
      list.mode === 'surprise' ? badge('Niespodzianka', 'surprise') : null,
      list.status === 'archived' ? badge('Archiwalna', 'muted') : null,
    ),
    h('h3', {}, h('a', { href: `#/lists/${list.id}`, class: 'stretched' }, list.name)),
    showOwner ? h('p', { class: 'meta' }, 'Lista: ', h('strong', {}, list.owner.name)) : null,
    when,
    list.mode === 'standard'
      ? h('p', { class: 'meta' }, icon('gift'), ` ${list.itemCount} ${plural(list.itemCount, 'prezent', 'prezenty', 'prezentów')}`)
      : h('p', { class: 'meta' }, icon('sparkle'), ' Wskazówki zamiast konkretnych prezentów'),
  );
}

export function plural(n, one, few, many) {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export async function dashboardView() {
  const d = await api.get('/dashboard');
  const active = d.myLists.filter((l) => l.status === 'active');

  const myListsSection = h(
    'section',
    { class: 'section', 'aria-labelledby': 'my-lists-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'my-lists-h' }, 'Moje aktywne listy'), h('a', { href: '#/lists/new', class: 'btn btn-sm btn-primary' }, icon('plus'), ' Nowa lista')),
    active.length
      ? h('ul', { class: 'card-grid' }, active.map((l) => listCard(l)))
      : emptyState({
          title: 'Nie masz jeszcze żadnej listy',
          text: 'Napisz swój pierwszy list do Mikołaja — dodaj prezenty, o których marzysz.',
          action: h('a', { href: '#/lists/new', class: 'btn btn-primary' }, 'Utwórz listę'),
        }),
  );

  const friendsSection = h(
    'section',
    { class: 'section', 'aria-labelledby': 'friends-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'friends-h' }, 'Listy bliskich')),
    d.friendsLists.length
      ? h('ul', { class: 'card-grid' }, d.friendsLists.map((l) => listCard(l, { showOwner: true })))
      : emptyState({
          iconName: 'users',
          title: d.groupCount ? 'Twoi bliscy nie mają jeszcze list' : 'Nie należysz jeszcze do żadnej grupy',
          text: d.groupCount
            ? 'Gdy ktoś z Twoich grup opublikuje listę, zobaczysz ją tutaj.'
            : 'Utwórz grupę rodzinną lub dołącz do istniejącej za pomocą kodu zaproszenia.',
          action: d.groupCount
            ? null
            : h('div', { class: 'btn-row' }, h('a', { href: '#/groups', class: 'btn btn-primary' }, 'Utwórz grupę'), h('a', { href: '#/join', class: 'btn btn-ghost' }, 'Dołącz kodem')),
        }),
  );

  const claimsSection = h(
    'section',
    { class: 'section', 'aria-labelledby': 'claims-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'claims-h' }, 'Moje zaklepane prezenty')),
    d.myClaims.length
      ? h(
          'ul',
          { class: 'claims card' },
          d.myClaims.map((c) =>
            h(
              'li',
              {},
              h('span', { class: 'claim-icon' }, icon(c.kind === 'idea' ? 'sparkle' : 'check')),
              h('div', {}, h('strong', {}, c.name), h('span', { class: 'meta' }, ` dla ${c.owner.name} · `, h('a', { href: `#/lists/${c.list.id}` }, c.list.name))),
              c.kind === 'idea' ? badge('Tajny pomysł', 'surprise') : null,
            ),
          ),
        )
      : h('p', { class: 'muted' }, 'Nie zaklepano jeszcze żadnych prezentów. Zajrzyj na listy bliskich!'),
  );

  return h(
    'div',
    {},
    pageHeader(`Cześć, ${state.user.name}!`, { subtitle: 'Oto, co słychać w Twoich świątecznych sprawach.' }),
    myListsSection,
    friendsSection,
    claimsSection,
  );
}
