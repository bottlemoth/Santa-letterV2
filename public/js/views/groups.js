import { api } from '../api.js';
import { h, icon } from '../dom.js';
import {
  pageHeader, emptyState, field, handleSubmit, formObject, toast, openDialog, confirmDialog,
  GROUP_KINDS, badge, formatDate,
} from '../ui.js';
import { state } from '../state.js';
import { plural } from './dashboard.js';

function groupForm(group, submitLabel, onSubmit) {
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    field({ name: 'name', label: 'Nazwa grupy', required: true, value: group?.name, attrs: { maxlength: 80 } }),
    field({ name: 'kind', label: 'Rodzaj grupy', type: 'select', options: GROUP_KINDS, value: group?.kind || 'family' }),
    field({ name: 'description', label: 'Opis (opcjonalnie)', type: 'textarea', value: group?.description, attrs: { maxlength: 500 } }),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel)),
  );
  return handleSubmit(form, (fd) => onSubmit(formObject(fd)));
}

export async function groupsView() {
  const { groups } = await api.get('/groups');

  const createBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), ' Nowa grupa');
  createBtn.addEventListener('click', () => {
    const { close } = openDialog({
      title: 'Nowa grupa',
      content: groupForm(null, 'Utwórz grupę', async (data) => {
        const res = await api.post('/groups', data);
        close();
        toast('Grupa została utworzona. Zaproś bliskich kodem!');
        state.navigate(`/groups/${res.group.id}`);
      }),
    });
  });

  return h(
    'div',
    {},
    pageHeader('Twoje grupy', {
      subtitle: 'Listy prezentowe widzą wszyscy członkowie wspólnych grup.',
      actions: [h('a', { href: '#/join', class: 'btn btn-ghost' }, 'Dołącz kodem'), createBtn],
    }),
    groups.length
      ? h(
          'ul',
          { class: 'card-grid' },
          groups.map((g) =>
            h(
              'li',
              { class: 'card group-card' },
              h('div', { class: 'list-card-top' }, badge(GROUP_KINDS[g.kind], g.kind), g.role === 'admin' ? badge('Administrator', 'gold') : null),
              h('h3', {}, h('a', { href: `#/groups/${g.id}`, class: 'stretched' }, g.name)),
              g.description ? h('p', { class: 'muted clamp' }, g.description) : null,
              h('p', { class: 'meta' }, icon('users'), ` ${g.memberCount} ${plural(g.memberCount, 'członek', 'członków', 'członków')}`),
            ),
          ),
        )
      : emptyState({
          iconName: 'users',
          title: 'Nie należysz jeszcze do żadnej grupy',
          text: 'Utwórz grupę dla rodziny lub znajomych albo dołącz do istniejącej za pomocą kodu.',
          action: h('a', { href: '#/join', class: 'btn btn-ghost' }, 'Mam kod zaproszenia'),
        }),
  );
}

export async function groupDetailView({ id }) {
  const { group } = await api.get(`/groups/${encodeURIComponent(id)}`);
  const isAdmin = group.role === 'admin';
  const rerender = () => state.navigate(`/groups/${group.id}`);
  const inviteLink = `${location.origin}/#/join/${group.inviteCode}`;

  // --- zaproszenie ---
  const copyBtn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, icon('link'), ' Kopiuj link');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast('Link zaproszenia skopiowany do schowka.');
    } catch {
      toast('Nie udało się skopiować — zaznacz link i skopiuj ręcznie.', 'error');
    }
  });
  const regenBtn = isAdmin ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, 'Wygeneruj nowy kod') : null;
  regenBtn?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Nowy kod zaproszenia',
      message: 'Dotychczasowy kod i link przestaną działać. Kontynuować?',
      confirmText: 'Wygeneruj',
    });
    if (!ok) return;
    try {
      await api.post(`/groups/${group.id}/invite-code`);
      toast('Wygenerowano nowy kod zaproszenia.');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const invite = h(
    'section',
    { class: 'card invite', 'aria-labelledby': 'invite-h' },
    h('h2', { id: 'invite-h' }, 'Zaproś bliskich'),
    h('p', { class: 'muted' }, 'Przekaż kod lub link osobom, które chcesz dodać do grupy.'),
    h('p', { class: 'invite-code', 'aria-label': `Kod zaproszenia: ${group.inviteCode.split('').join(' ')}` }, group.inviteCode),
    h('label', { class: 'visually-hidden', for: 'invite-link' }, 'Link zaproszenia'),
    h('input', { id: 'invite-link', class: 'invite-link', type: 'text', readonly: true, value: inviteLink, onfocus: (e) => e.target.select() }),
    h('div', { class: 'btn-row' }, copyBtn, regenBtn),
  );

  // --- członkowie ---
  const memberRow = (m) => {
    const actions = [];
    if (isAdmin && !m.isMe) {
      const transfer = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, 'Przekaż własność');
      transfer.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Przekazanie własności',
          message: `${m.name} zostanie administratorem grupy, a Ty zwykłym członkiem. Kontynuować?`,
          confirmText: 'Przekaż',
        });
        if (!ok) return;
        try {
          await api.post(`/groups/${group.id}/transfer`, { userId: m.id });
          toast(`${m.name} jest teraz administratorem grupy.`);
          rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      const remove = h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost' }, 'Usuń');
      remove.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Usunięcie członka',
          message: `Czy na pewno usunąć ${m.name} z grupy „${group.name}”?`,
          confirmText: 'Usuń z grupy',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/groups/${group.id}/members/${m.id}`);
          toast(`Usunięto ${m.name} z grupy.`);
          rerender();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      actions.push(transfer, remove);
    }
    return h(
      'li',
      { class: 'member' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, m.name.trim().charAt(0).toUpperCase()),
      h(
        'div',
        { class: 'member-info' },
        m.isMe ? h('strong', {}, `${m.name} (Ty)`) : h('a', { href: `#/users/${m.id}` }, m.name),
        h('span', { class: 'meta' }, m.role === 'admin' ? 'Administrator · ' : '', 'w grupie od ', formatDate(m.joinedAt)),
      ),
      actions.length ? h('div', { class: 'member-actions' }, actions) : null,
    );
  };

  const members = h(
    'section',
    { class: 'card', 'aria-labelledby': 'members-h' },
    h('h2', { id: 'members-h' }, `Członkowie (${group.members.length})`),
    h('ul', { class: 'members' }, group.members.map(memberRow)),
    group.members.length === 1 ? h('p', { class: 'muted' }, 'Na razie jesteś tu sam(a). Wyślij komuś kod zaproszenia!') : null,
  );

  // --- akcje ---
  const editBtn = isAdmin ? h('button', { type: 'button', class: 'btn btn-ghost' }, icon('edit'), ' Edytuj grupę') : null;
  editBtn?.addEventListener('click', () => {
    const { close } = openDialog({
      title: 'Edycja grupy',
      content: groupForm(group, 'Zapisz zmiany', async (data) => {
        await api.patch(`/groups/${group.id}`, data);
        close();
        toast('Zapisano zmiany w grupie.');
        rerender();
      }),
    });
  });

  const leaveBtn = h('button', { type: 'button', class: 'btn btn-danger-ghost' }, 'Opuść grupę');
  leaveBtn.addEventListener('click', async () => {
    const alone = group.members.length === 1;
    if (isAdmin && !alone) {
      toast('Przed opuszczeniem grupy przekaż jej własność innemu członkowi.', 'error');
      return;
    }
    const ok = await confirmDialog({
      title: 'Opuszczenie grupy',
      message: alone
        ? 'Jesteś jedynym członkiem — opuszczenie grupy spowoduje jej usunięcie. Kontynuować?'
        : `Czy na pewno chcesz opuścić grupę „${group.name}”? Stracisz dostęp do list jej członków.`,
      confirmText: 'Opuść grupę',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/groups/${group.id}/leave`);
      toast('Opuszczono grupę.');
      state.navigate('/groups');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  return h(
    'div',
    {},
    pageHeader(group.name, {
      subtitle: group.description || `${GROUP_KINDS[group.kind]} · ${isAdmin ? 'jesteś administratorem' : 'jesteś członkiem'}`,
      back: { href: '#/groups', label: 'Wszystkie grupy' },
      actions: [editBtn, leaveBtn],
    }),
    h('div', { class: 'two-col' }, members, invite),
  );
}

export function joinView({ code } = {}) {
  const form = h(
    'form',
    { class: 'card form', novalidate: true },
    field({
      name: 'code',
      label: 'Kod zaproszenia',
      required: true,
      value: code || '',
      hint: 'Kod składa się z 8 liter i cyfr, np. K7MP3QXA.',
      attrs: { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 20, class: 'code-input' },
    }),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Dołącz do grupy')),
  );
  handleSubmit(form, async (fd) => {
    try {
      const res = await api.post('/groups/join', formObject(fd));
      toast(`Witamy w grupie „${res.group.name}”!`);
      state.refreshUnread();
      state.navigate(`/groups/${res.group.id}`);
    } catch (err) {
      if (err.status === 409 && err.data.groupId) {
        toast(err.message);
        state.navigate(`/groups/${err.data.groupId}`);
        return;
      }
      throw err;
    }
  });
  return h(
    'section',
    { class: 'auth-page' },
    h('h1', {}, 'Dołącz do grupy'),
    h('p', { class: 'subtitle' }, 'Wpisz kod otrzymany od administratora grupy.'),
    form,
  );
}
