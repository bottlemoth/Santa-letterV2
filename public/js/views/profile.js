import { api } from '../api.js';
import { h } from '../dom.js';
import { pageHeader, field, handleSubmit, formObject, toast, formatDate } from '../ui.js';
import { state } from '../state.js';

export function profileView() {
  const u = state.user;
  const form = h(
    'form',
    { class: 'card form', novalidate: true },
    field({ name: 'name', label: 'Imię lub nazwa', required: true, value: u.name, attrs: { autocomplete: 'name', maxlength: 80 } }),
    field({ name: 'email', label: 'Adres e-mail', type: 'email', required: true, value: u.email, attrs: { autocomplete: 'email' } }),
    h(
      'fieldset',
      { class: 'fieldset' },
      h('legend', {}, 'Zmiana hasła (opcjonalnie)'),
      field({ name: 'newPassword', label: 'Nowe hasło', type: 'password', hint: 'Co najmniej 8 znaków. Zostaw puste, aby nie zmieniać.', attrs: { autocomplete: 'new-password' } }),
    ),
    field({
      name: 'currentPassword',
      label: 'Aktualne hasło',
      type: 'password',
      hint: 'Wymagane przy zmianie adresu e-mail lub hasła.',
      attrs: { autocomplete: 'current-password' },
    }),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Zapisz zmiany')),
  );
  handleSubmit(form, async (fd) => {
    const data = formObject(fd);
    const payload = { name: data.name, email: data.email };
    if (data.newPassword) payload.newPassword = data.newPassword;
    if (data.currentPassword) payload.currentPassword = data.currentPassword;
    const res = await api.patch('/me', payload);
    state.user = res.user;
    state.onAuthChange();
    toast('Profil zaktualizowany.');
    state.navigate('/profile');
  });
  return h(
    'div',
    { class: 'narrow' },
    pageHeader('Twój profil', { subtitle: `Konto założone ${formatDate(u.createdAt)}.` }),
    form,
  );
}
