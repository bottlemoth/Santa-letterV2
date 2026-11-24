import { api } from '../api.js';
import { h, icon } from '../dom.js';
import { pageHeader, emptyState, field, handleSubmit, formObject, toast, OCCASIONS } from '../ui.js';
import { state } from '../state.js';
import { listCard } from './dashboard.js';

export async function myListsView() {
  const { lists } = await api.get('/lists/mine');
  const active = lists.filter((l) => l.status === 'active');
  const archived = lists.filter((l) => l.status === 'archived');
  return h(
    'div',
    {},
    pageHeader('Moje listy', {
      subtitle: 'Twoje listy widzą członkowie wszystkich Twoich grup.',
      actions: h('a', { href: '#/lists/new', class: 'btn btn-primary' }, icon('plus'), ' Nowa lista'),
    }),
    lists.length === 0
      ? emptyState({
          title: 'Twoja skrzynka na listy jest pusta',
          text: 'Utwórz listę na święta, urodziny lub dowolną inną okazję.',
          action: h('a', { href: '#/lists/new', class: 'btn btn-primary' }, 'Utwórz pierwszą listę'),
        })
      : [
          h(
            'section',
            { class: 'section', 'aria-labelledby': 'active-h' },
            h('h2', { id: 'active-h' }, 'Aktywne'),
            active.length ? h('ul', { class: 'card-grid' }, active.map((l) => listCard(l))) : h('p', { class: 'muted' }, 'Brak aktywnych list.'),
          ),
          archived.length
            ? h(
                'section',
                { class: 'section', 'aria-labelledby': 'arch-h' },
                h('h2', { id: 'arch-h' }, 'Archiwalne'),
                h('ul', { class: 'card-grid' }, archived.map((l) => listCard(l))),
              )
            : null,
        ],
  );
}

export function surpriseFields(sp = {}) {
  return h(
    'fieldset',
    { class: 'fieldset' },
    h('legend', {}, 'Wskazówki dla obdarowujących'),
    h('p', { class: 'hint' }, 'Wszystkie pola są opcjonalne. Bliscy zobaczą je i wymyślą dla Ciebie tajny prezent.'),
    field({ name: 'interests', label: 'Zainteresowania', type: 'textarea', value: sp.interests, attrs: { maxlength: 1000 } }),
    field({ name: 'categories', label: 'Kategorie / obszary tematyczne', type: 'textarea', value: sp.categories, attrs: { maxlength: 1000 } }),
    field({ name: 'preferences', label: 'Preferencje (kolory, styl, marki)', type: 'textarea', value: sp.preferences, attrs: { maxlength: 1000 } }),
    field({ name: 'sizes', label: 'Rozmiary', value: sp.sizes, hint: 'Np. koszulka M, buty 42, pierścionek 15.', attrs: { maxlength: 500 } }),
    h(
      'div',
      { class: 'field-row' },
      field({ name: 'budgetMin', label: 'Budżet od', value: sp.budgetMin, attrs: { inputmode: 'decimal' } }),
      field({ name: 'budgetMax', label: 'Budżet do', value: sp.budgetMax, attrs: { inputmode: 'decimal' } }),
      field({ name: 'currency', label: 'Waluta', value: sp.currency || 'PLN', attrs: { maxlength: 3, class: 'input-short' } }),
    ),
    field({ name: 'dislikes', label: 'Czego nie chcę dostać', type: 'textarea', value: sp.dislikes, attrs: { maxlength: 1000 } }),
    field({ name: 'notes', label: 'Dodatkowe uwagi', type: 'textarea', value: sp.notes, attrs: { maxlength: 1000 } }),
  );
}

export const SURPRISE_KEYS = ['interests', 'categories', 'preferences', 'sizes', 'budgetMin', 'budgetMax', 'currency', 'dislikes', 'notes'];

export async function listFormView({ id } = {}) {
  const editing = Boolean(id);
  let list = null;
  if (editing) {
    list = (await api.get(`/lists/${encodeURIComponent(id)}`)).list;
    if (!list.isOwner) throw new Error('Możesz edytować tylko własne listy.');
  }

  const labelField = field({ name: 'occasionLabel', label: 'Nazwa okazji', value: list?.occasionLabel, hint: 'Np. imieniny, parapetówka, ślub.', attrs: { maxlength: 80 } });
  const occasionField = field({ name: 'occasion', label: 'Okazja', type: 'select', options: OCCASIONS, value: list?.occasion || 'christmas' });
  const syncLabel = () => {
    labelField.hidden = occasionField.querySelector('select').value !== 'other';
  };
  occasionField.querySelector('select').addEventListener('change', syncLabel);

  const surpriseBox = editing ? null : h('div', { class: 'surprise-box', hidden: true }, surpriseFields());
  const modeField = editing
    ? null
    : h(
        'fieldset',
        { class: 'fieldset mode-choice' },
        h('legend', {}, 'Rodzaj listy'),
        h(
          'label',
          { class: 'choice' },
          h('input', { type: 'radio', name: 'mode', value: 'standard', checked: true }),
          h('span', {}, h('strong', {}, 'Zwykła lista'), h('small', {}, 'Dodajesz konkretne prezenty z linkami i zdjęciami.')),
        ),
        h(
          'label',
          { class: 'choice' },
          h('input', { type: 'radio', name: 'mode', value: 'surprise' }),
          h('span', {}, h('strong', {}, 'Niespodzianka'), h('small', {}, 'Podajesz tylko wskazówki — bliscy wymyślą prezent w tajemnicy.')),
        ),
      );
  modeField?.addEventListener('change', (e) => {
    surpriseBox.hidden = e.target.value !== 'surprise';
  });

  const form = h(
    'form',
    { class: 'card form', novalidate: true },
    field({ name: 'name', label: 'Nazwa listy', required: true, value: list?.name, attrs: { maxlength: 120, placeholder: 'Np. Święta 2026' } }),
    h('div', { class: 'field-row' }, occasionField, field({ name: 'eventDate', label: 'Data wydarzenia (opcjonalnie)', type: 'date', value: list?.eventDate })),
    labelField,
    field({ name: 'description', label: 'Opis (opcjonalnie)', type: 'textarea', value: list?.description, attrs: { maxlength: 1000 } }),
    editing
      ? field({ name: 'status', label: 'Status', type: 'select', options: { active: 'Aktywna', archived: 'Archiwalna' }, value: list.status })
      : null,
    modeField,
    surpriseBox,
    h(
      'div',
      { class: 'form-actions' },
      h('a', { href: editing ? `#/lists/${list.id}` : '#/lists', class: 'btn btn-ghost' }, 'Anuluj'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, editing ? 'Zapisz zmiany' : 'Utwórz listę'),
    ),
  );
  syncLabel();

  handleSubmit(form, async (fd) => {
    const data = formObject(fd);
    const payload = {
      name: data.name,
      occasion: data.occasion,
      occasionLabel: data.occasion === 'other' ? data.occasionLabel : '',
      description: data.description,
      eventDate: data.eventDate,
    };
    if (editing) {
      payload.status = data.status;
      await api.patch(`/lists/${list.id}`, payload);
      toast('Zapisano zmiany listy.');
      state.navigate(`/lists/${list.id}`);
      return;
    }
    payload.mode = data.mode;
    if (data.mode === 'surprise') {
      payload.surprise = Object.fromEntries(SURPRISE_KEYS.map((k) => [k, data[k]]));
    }
    // Błędy pól profilu niespodzianki mają te same nazwy, co pola formularza.
    const res = await api.post('/lists', payload);
    toast('Lista utworzona!');
    state.navigate(`/lists/${res.list.id}`);
  });

  return h(
    'div',
    { class: 'narrow' },
    pageHeader(editing ? 'Edycja listy' : 'Nowa lista', {
      back: editing ? { href: `#/lists/${list.id}`, label: 'Wróć do listy' } : { href: '#/lists', label: 'Moje listy' },
    }),
    form,
  );
}

export async function userListsView({ id }) {
  const { user, lists } = await api.get(`/users/${encodeURIComponent(id)}/lists`);
  if (state.user && user.id === state.user.id) {
    state.navigate('/lists');
    return h('div');
  }
  const active = lists.filter((l) => l.status === 'active');
  const archived = lists.filter((l) => l.status === 'archived');
  return h(
    'div',
    {},
    pageHeader(`Listy: ${user.name}`, { back: { href: '#/dashboard', label: 'Pulpit' } }),
    active.length
      ? h('ul', { class: 'card-grid' }, active.map((l) => listCard(l, { showOwner: false })))
      : emptyState({ title: `${user.name} nie ma jeszcze aktywnych list`, text: 'Zajrzyj tu później — może Mikołaj dostanie list wkrótce.' }),
    archived.length
      ? h('section', { class: 'section' }, h('h2', {}, 'Archiwalne'), h('ul', { class: 'card-grid' }, archived.map((l) => listCard(l))))
      : null,
  );
}
