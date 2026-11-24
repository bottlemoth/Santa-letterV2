import { api } from '../api.js';
import { h, icon, safeHref } from '../dom.js';
import {
  pageHeader, emptyState, field, handleSubmit, toast, openDialog, confirmDialog, badge,
  occasionLabel, formatDate, formatPrice, PRIORITIES, formObject,
} from '../ui.js';
import { state } from '../state.js';
import { surpriseFields, SURPRISE_KEYS } from './lists.js';

// ---------- wspólne elementy ----------

function externalLink(url, label = 'Zobacz produkt') {
  if (!url || safeHref(url) === '#') return null;
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'ext-link' }, icon('link'), ` ${label}`, h('span', { class: 'visually-hidden' }, ' (otwiera się w nowej karcie)'));
}

function thumb(src, alt) {
  if (!src) return h('div', { class: 'thumb thumb-empty', 'aria-hidden': 'true' }, icon('gift'));
  return h('img', { class: 'thumb', src, alt, loading: 'lazy', referrerpolicy: 'no-referrer' });
}

/** Pola obrazka: plik LUB adres URL, z opcją usunięcia przy edycji. */
function imageFields(current) {
  return h(
    'fieldset',
    { class: 'fieldset' },
    h('legend', {}, 'Zdjęcie (opcjonalnie)'),
    field({ name: 'image', label: 'Wgraj plik', type: 'file', hint: 'JPG, PNG, WEBP lub GIF, maks. 5 MB.', attrs: { accept: 'image/jpeg,image/png,image/webp,image/gif' } }),
    field({ name: 'imageUrl', label: 'albo podaj adres zdjęcia', type: 'url', value: current && !current.hasUploadedImage ? current.imageUrl : '', hint: 'Adres musi zaczynać się od https://', attrs: { placeholder: 'https://…' } }),
    current && current.image ? field({ name: 'removeImage', label: 'Usuń obecne zdjęcie', type: 'checkbox' }) : null,
  );
}

/** Buduje FormData, pomijając pusty plik (przeglądarki wysyłają pusty wpis). */
function toFormData(form) {
  const fd = new FormData(form);
  const file = fd.get('image');
  if (file && typeof file !== 'string' && file.size === 0) fd.delete('image');
  if (!form.querySelector('[name=removeImage]')?.checked) fd.delete('removeImage');
  else fd.set('removeImage', 'true');
  return fd;
}

function infoRow(label, value) {
  if (!value) return null;
  return [h('dt', {}, label), h('dd', {}, value)];
}

// ---------- pozycje: formularz właściciela ----------

function itemDialog(list, item, rerender) {
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    field({ name: 'name', label: 'Nazwa prezentu', required: true, value: item?.name, attrs: { maxlength: 200 } }),
    field({ name: 'url', label: 'Link do produktu', type: 'url', value: item?.url, attrs: { placeholder: 'https://…' } }),
    h(
      'div',
      { class: 'field-row' },
      field({ name: 'price', label: 'Orientacyjna cena', value: item?.price, attrs: { inputmode: 'decimal', placeholder: 'np. 149,99' } }),
      field({ name: 'currency', label: 'Waluta', value: item?.currency || 'PLN', attrs: { maxlength: 3, class: 'input-short' } }),
      field({ name: 'priority', label: 'Priorytet', type: 'select', options: PRIORITIES, value: item?.priority || 'medium' }),
    ),
    field({ name: 'notes', label: 'Uwagi', type: 'textarea', value: item?.notes, hint: 'Np. rozmiar, kolor, wariant.', attrs: { maxlength: 1000 } }),
    imageFields(item),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, item ? 'Zapisz zmiany' : 'Dodaj prezent')),
  );
  const { close } = openDialog({ title: item ? 'Edycja prezentu' : 'Nowy prezent', content: form });
  handleSubmit(form, async () => {
    const fd = toFormData(form);
    if (item) await api.patch(`/items/${item.id}`, fd);
    else await api.post(`/lists/${list.id}/items`, fd);
    close();
    toast(item ? 'Zapisano zmiany.' : 'Dodano prezent do listy.');
    rerender();
  });
}

function ownerItemCard(list, item, rerender) {
  const edit = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, icon('edit'), ' Edytuj');
  edit.addEventListener('click', () => itemDialog(list, item, rerender));
  const del = h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost' }, icon('trash'), ' Usuń');
  del.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Usunięcie prezentu', message: `Usunąć „${item.name}” z listy?`, confirmText: 'Usuń', danger: true });
    if (!ok) return;
    try {
      await api.del(`/items/${item.id}`);
      toast('Usunięto prezent.');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return itemCard(item, [edit, del], null);
}

function itemCard(item, actions, statusEl) {
  return h(
    'li',
    { class: `card item-card priority-${item.priority}` },
    thumb(item.image, `Zdjęcie: ${item.name}`),
    h(
      'div',
      { class: 'item-body' },
      h('div', { class: 'item-head' }, h('h3', {}, item.name), badge(`Priorytet: ${PRIORITIES[item.priority]}`, `prio-${item.priority}`)),
      item.price ? h('p', { class: 'price' }, formatPrice(item.price, item.currency)) : null,
      item.notes ? h('p', { class: 'notes' }, item.notes) : null,
      externalLink(item.url),
      statusEl,
      actions && actions.length ? h('div', { class: 'item-actions' }, actions) : null,
    ),
  );
}

// ---------- pozycje: widok gościa (z rezerwacjami) ----------

function guestItemCard(list, item, rerender) {
  const r = item.reservation;
  let status;
  const actions = [];
  if (!r) {
    status = h('p', { class: 'status status-free' }, icon('gift'), ' Wolne — możesz zaklepać');
    if (list.status === 'active') {
      const btn = h('button', { type: 'button', class: 'btn btn-sm btn-primary' }, 'Zaklep prezent');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api.post(`/items/${item.id}/reservation`);
          toast(`Zaklepano „${item.name}”. ${list.owner.name} się nie dowie!`);
        } catch (err) {
          toast(err.message, 'error');
        }
        rerender();
      });
      actions.push(btn);
    }
  } else if (r.isMine) {
    status = h('p', { class: 'status status-mine' }, icon('check'), ' Zaklepane przez Ciebie');
    const btn = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, 'Anuluj rezerwację');
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Anulowanie rezerwacji', message: `Zwolnić „${item.name}”? Inni będą mogli go zaklepać.`, confirmText: 'Anuluj rezerwację' });
      if (!ok) return;
      try {
        await api.del(`/items/${item.id}/reservation`);
        toast('Rezerwacja anulowana.');
      } catch (err) {
        toast(err.message, 'error');
      }
      rerender();
    });
    actions.push(btn);
  } else {
    status = h('p', { class: 'status status-taken' }, icon('lock'), ' Zaklepane przez: ', h('strong', {}, r.reservedBy.name));
  }
  return itemCard(item, actions, status);
}

// ---------- tryb niespodzianki ----------

function surpriseInfo(list) {
  const sp = list.surprise || {};
  const budget =
    sp.budgetMin || sp.budgetMax
      ? [sp.budgetMin ? `od ${formatPrice(sp.budgetMin, sp.currency)}` : '', sp.budgetMax ? `do ${formatPrice(sp.budgetMax, sp.currency)}` : ''].filter(Boolean).join(' ')
      : null;
  const rows = [
    infoRow('Zainteresowania', sp.interests),
    infoRow('Kategorie', sp.categories),
    infoRow('Preferencje', sp.preferences),
    infoRow('Rozmiary', sp.sizes),
    infoRow('Budżet', budget),
    infoRow('Czego nie chcę', sp.dislikes),
    infoRow('Uwagi', sp.notes),
  ].filter(Boolean);
  return h(
    'section',
    { class: 'card surprise-card', 'aria-labelledby': 'sp-h' },
    h('h2', { id: 'sp-h' }, icon('sparkle'), ' Wskazówki'),
    rows.length ? h('dl', { class: 'info-list' }, rows) : h('p', { class: 'muted' }, 'Brak wskazówek — liczy się inwencja!'),
  );
}

function surpriseDialog(list, rerender) {
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    surpriseFields(list.surprise),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Zapisz wskazówki')),
  );
  const { close } = openDialog({ title: 'Wskazówki dla obdarowujących', content: form });
  handleSubmit(form, async (fd) => {
    const data = formObject(fd);
    await api.put(`/lists/${list.id}/surprise`, Object.fromEntries(SURPRISE_KEYS.map((k) => [k, data[k]])));
    close();
    toast('Zapisano wskazówki.');
    rerender();
  });
}

function ideaDialog(list, idea, rerender) {
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    h('p', { class: 'alert alert-info' }, icon('lock'), ` Pomysł zobaczą inni członkowie grup — ale nigdy ${list.owner.name}. Pomysł jest automatycznie zaklepany przez Ciebie.`),
    field({ name: 'name', label: 'Pomysł na prezent', required: true, value: idea?.name, attrs: { maxlength: 200 } }),
    field({ name: 'url', label: 'Link (opcjonalnie)', type: 'url', value: idea?.url, attrs: { placeholder: 'https://…' } }),
    field({ name: 'privateNote', label: 'Prywatna uwaga', type: 'textarea', value: idea?.privateNote, hint: 'Widoczna tylko dla Ciebie.', attrs: { maxlength: 1000 } }),
    imageFields(idea),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, idea ? 'Zapisz zmiany' : 'Dodaj tajny pomysł')),
  );
  const { close } = openDialog({ title: idea ? 'Edycja pomysłu' : 'Nowy tajny pomysł', content: form });
  handleSubmit(form, async () => {
    const fd = toFormData(form);
    if (idea) await api.patch(`/ideas/${idea.id}`, fd);
    else await api.post(`/lists/${list.id}/ideas`, fd);
    close();
    toast(idea ? 'Zapisano pomysł.' : 'Dodano tajny pomysł — jest zaklepany przez Ciebie.');
    rerender();
  });
}

function ideaCard(list, idea, rerender) {
  const actions = [];
  if (idea.isMine) {
    const edit = h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, icon('edit'), ' Edytuj');
    edit.addEventListener('click', () => ideaDialog(list, idea, rerender));
    const del = h('button', { type: 'button', class: 'btn btn-sm btn-danger-ghost' }, 'Anuluj pomysł');
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Anulowanie pomysłu', message: `Usunąć pomysł „${idea.name}”?`, confirmText: 'Usuń pomysł', danger: true });
      if (!ok) return;
      try {
        await api.del(`/ideas/${idea.id}`);
        toast('Pomysł usunięty.');
      } catch (err) {
        toast(err.message, 'error');
      }
      rerender();
    });
    actions.push(edit, del);
  }
  return h(
    'li',
    { class: 'card item-card idea-card' },
    thumb(idea.image, `Zdjęcie: ${idea.name}`),
    h(
      'div',
      { class: 'item-body' },
      h('div', { class: 'item-head' }, h('h3', {}, idea.name), badge('Tajny pomysł', 'surprise')),
      h('p', { class: `status ${idea.isMine ? 'status-mine' : 'status-taken'}` }, icon(idea.isMine ? 'check' : 'lock'), idea.isMine ? ' Twój pomysł — zaklepany przez Ciebie' : ' Pomysł i rezerwacja: ', idea.isMine ? null : h('strong', {}, idea.author.name)),
      idea.isMine && idea.privateNote ? h('p', { class: 'notes' }, h('span', { class: 'visually-hidden' }, 'Prywatna uwaga: '), idea.privateNote) : null,
      externalLink(idea.url, 'Zobacz'),
      actions.length ? h('div', { class: 'item-actions' }, actions) : null,
    ),
  );
}

// ---------- widok główny ----------

export async function listView({ id }) {
  const { list } = await api.get(`/lists/${encodeURIComponent(id)}`);
  const rerender = () => state.navigate(`/lists/${list.id}`);
  const isOwner = list.isOwner;

  const metaParts = [
    badge(occasionLabel(list), list.occasion),
    list.mode === 'surprise' ? badge('Niespodzianka', 'surprise') : null,
    list.status === 'archived' ? badge('Archiwalna', 'muted') : null,
    list.eventDate ? h('span', { class: 'meta' }, icon('calendar'), ' ', formatDate(list.eventDate)) : null,
  ];

  const actions = [];
  if (isOwner) {
    actions.push(h('a', { href: `#/lists/${list.id}/edit`, class: 'btn btn-ghost' }, icon('edit'), ' Edytuj listę'));
    const del = h('button', { type: 'button', class: 'btn btn-danger-ghost' }, 'Usuń listę');
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Usunięcie listy', message: `Usunąć listę „${list.name}” razem z całą zawartością? Tej operacji nie można cofnąć.`, confirmText: 'Usuń listę', danger: true });
      if (!ok) return;
      try {
        await api.del(`/lists/${list.id}`);
        toast('Lista usunięta.');
        state.navigate('/lists');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    actions.push(del);
  }

  const header = pageHeader(list.name, {
    subtitle: isOwner ? 'Twoja lista' : `Lista: ${list.owner.name}`,
    back: isOwner ? { href: '#/lists', label: 'Moje listy' } : { href: `#/users/${list.owner.id}`, label: `Wszystkie listy: ${list.owner.name}` },
    actions,
  });

  const parts = [header, h('div', { class: 'list-meta' }, metaParts)];
  if (list.description) parts.push(h('p', { class: 'list-description' }, list.description));
  if (list.status === 'archived') {
    parts.push(h('p', { class: 'alert alert-info' }, 'Ta lista jest archiwalna — nie można już zaklepywać z niej prezentów.'));
  }

  if (list.mode === 'standard') {
    if (isOwner) {
      parts.push(
        h('p', { class: 'alert alert-secret' }, icon('lock'), ' Nie widzisz, które prezenty zostały zaklepane — tak ma być! Dzięki temu niespodzianka pozostaje niespodzianką.'),
      );
      const add = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), ' Dodaj prezent');
      add.addEventListener('click', () => itemDialog(list, null, rerender));
      parts.push(
        h(
          'section',
          { class: 'section', 'aria-labelledby': 'items-h' },
          h('div', { class: 'section-head' }, h('h2', { id: 'items-h' }, `Prezenty (${list.items.length})`), add),
          list.items.length
            ? h('ul', { class: 'items' }, list.items.map((it) => ownerItemCard(list, it, rerender)))
            : emptyState({ title: 'Lista jest jeszcze pusta', text: 'Dodaj pierwszy prezent — z linkiem, zdjęciem i ceną.' }),
        ),
      );
    } else {
      const free = list.items.filter((i) => !i.reservation).length;
      parts.push(
        h(
          'section',
          { class: 'section', 'aria-labelledby': 'items-h' },
          h('div', { class: 'section-head' }, h('h2', { id: 'items-h' }, `Prezenty (${list.items.length})`), h('span', { class: 'meta' }, `Wolnych: ${free}`)),
          list.items.length
            ? h('ul', { class: 'items' }, list.items.map((it) => guestItemCard(list, it, rerender)))
            : emptyState({ title: `${list.owner.name} nie dodał(a) jeszcze prezentów`, text: 'Zajrzyj tu później.' }),
        ),
      );
    }
  } else {
    parts.push(surpriseInfo(list));
    if (isOwner) {
      const edit = h('button', { type: 'button', class: 'btn btn-primary' }, icon('edit'), ' Edytuj wskazówki');
      edit.addEventListener('click', () => surpriseDialog(list, rerender));
      parts.push(
        h('div', { class: 'btn-row' }, edit),
        h('p', { class: 'alert alert-secret' }, icon('lock'), ' Bliscy dodają tu swoje tajne pomysły na prezent. Ty ich nie zobaczysz — i właśnie o to chodzi!'),
      );
    } else {
      const add = list.status === 'active' ? h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), ' Dodaj tajny pomysł') : null;
      add?.addEventListener('click', () => ideaDialog(list, null, rerender));
      parts.push(
        h(
          'section',
          { class: 'section', 'aria-labelledby': 'ideas-h' },
          h('div', { class: 'section-head' }, h('h2', { id: 'ideas-h' }, `Tajne pomysły (${list.ideas.length})`), add),
          h('p', { class: 'muted' }, `Te pomysły są niewidoczne dla: ${list.owner.name}. Każdy pomysł jest zaklepany przez jego autora.`),
          list.ideas.length
            ? h('ul', { class: 'items' }, list.ideas.map((i) => ideaCard(list, i, rerender)))
            : emptyState({ iconName: 'sparkle', title: 'Nikt jeszcze nie dodał pomysłu', text: 'Bądź pierwszą osobą, która wymyśli coś wyjątkowego!' }),
        ),
      );
    }
  }

  return h('div', { class: 'list-view' }, parts);
}
