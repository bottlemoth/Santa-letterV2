import { h, clear, icon } from './dom.js';

// ---------- etykiety i formatowanie ----------

export const OCCASIONS = {
  christmas: 'Boże Narodzenie',
  birthday: 'Urodziny',
  anniversary: 'Rocznica',
  other: 'Inna okazja',
};
export const PRIORITIES = { high: 'Wysoki', medium: 'Średni', low: 'Niski' };
export const GROUP_KINDS = { family: 'Rodzina', friends: 'Znajomi' };

export function occasionLabel(list) {
  if (list.occasion === 'other' && list.occasionLabel) return list.occasionLabel;
  return OCCASIONS[list.occasion] || 'Okazja';
}

const dateFmt = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(value) {
  if (!value) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}

export function formatDateTime(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
}

export function formatPrice(price, currency = 'PLN') {
  if (price === null || price === undefined || price === '') return '';
  try {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(Number(price));
  } catch {
    return `${price} ${currency}`;
  }
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.round((d - today) / 86400000);
}

// ---------- toasty ----------

export function toast(message, type = 'success') {
  const region = document.querySelector('.toasts');
  const el = h('div', { class: `toast toast-${type}` }, icon(type === 'error' ? 'bell' : 'check'), h('span', {}, message));
  region.append(el);
  setTimeout(() => {
    el.classList.add('toast-hide');
    setTimeout(() => el.remove(), 300);
  }, type === 'error' ? 6000 : 3500);
}

// ---------- okna dialogowe (<dialog> — natywna pułapka fokusu i obsługa Esc) ----------

export function openDialog({ title, content, onClose }) {
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const closeBtn = h('button', { type: 'button', class: 'btn-icon dialog-close', 'aria-label': 'Zamknij okno' }, '×');
  const dialog = h(
    'dialog',
    { class: 'dialog', 'aria-labelledby': titleId },
    h('div', { class: 'dialog-head' }, h('h2', { id: titleId }, title), closeBtn),
    h('div', { class: 'dialog-body' }, content),
  );
  const opener = document.activeElement;
  const close = () => dialog.close();
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onClose) onClose();
    if (opener && document.contains(opener)) opener.focus();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  document.body.append(dialog);
  dialog.showModal();
  const first = dialog.querySelector('input:not([type=hidden]), select, textarea');
  if (first) first.focus();
  return { dialog, close };
}

export function confirmDialog({ title, message, confirmText = 'Potwierdź', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, confirmText);
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Anuluj');
    const { close } = openDialog({
      title,
      content: [h('p', {}, message), h('div', { class: 'form-actions' }, cancel, ok)],
      onClose: () => resolve(result),
    });
    ok.addEventListener('click', () => {
      result = true;
      close();
    });
    cancel.addEventListener('click', close);
    cancel.focus();
  });
}

// ---------- formularze ----------

let fieldSeq = 0;

/**
 * Pole formularza z etykietą, podpowiedzią i miejscem na błąd (aria-describedby).
 * type: text|email|password|textarea|select|date|number|url|file|checkbox
 */
export function field({ name, label, type = 'text', value, required, options, hint, attrs = {} }) {
  fieldSeq += 1;
  const id = `f-${name}-${fieldSeq}`;
  const errId = `${id}-err`;
  const hintId = hint ? `${id}-hint` : null;
  const describedBy = [hintId, errId].filter(Boolean).join(' ');
  const common = { id, name, required, 'aria-describedby': describedBy, ...attrs };
  let control;
  if (type === 'textarea') {
    control = h('textarea', { rows: 3, ...common, value: value ?? '' });
  } else if (type === 'select') {
    control = h(
      'select',
      { ...common, value: value ?? '' },
      Object.entries(options).map(([v, l]) => h('option', { value: v }, l)),
    );
  } else if (type === 'checkbox') {
    control = h('input', { type: 'checkbox', ...common, checked: Boolean(value) });
    return h(
      'div',
      { class: 'field field-check' },
      control,
      h('label', { for: id }, label),
      hint && h('p', { class: 'hint', id: hintId }, hint),
      h('p', { class: 'field-error', id: errId, hidden: true }),
    );
  } else {
    control = h('input', { type, ...common, value: type === 'file' ? undefined : value ?? '' });
  }
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint && h('p', { class: 'hint', id: hintId }, hint),
    h('p', { class: 'field-error', id: errId, hidden: true }),
  );
}

export function clearFormErrors(form) {
  form.querySelectorAll('.field-error').forEach((p) => {
    p.textContent = '';
    p.hidden = true;
  });
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const summary = form.querySelector('.form-summary');
  if (summary) clear(summary).hidden = true;
}

/** Wyświetla błędy z API przy polach i w podsumowaniu (role=alert). */
export function showFormErrors(form, err) {
  clearFormErrors(form);
  let summary = form.querySelector('.form-summary');
  if (!summary) {
    summary = h('div', { class: 'form-summary alert alert-error', role: 'alert', tabindex: '-1' });
    form.prepend(summary);
  }
  summary.hidden = false;
  summary.textContent = err.message || 'Wystąpił błąd.';
  let firstInvalid = null;
  for (const [name, msg] of Object.entries(err.fields || {})) {
    const control = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!control) continue;
    control.setAttribute('aria-invalid', 'true');
    const errEl = form.querySelector(`#${CSS.escape(control.id)}-err`);
    if (errEl) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
    if (!firstInvalid) firstInvalid = control;
  }
  (firstInvalid || summary).focus();
}

/** Podpina obsługę submit z blokadą przycisku i wyświetlaniem błędów. */
export function handleSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    clearFormErrors(form);
    try {
      await fn(new FormData(form));
    } catch (err) {
      showFormErrors(form, err);
    } finally {
      if (btn && document.contains(btn)) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
  });
  return form;
}

/** FormData -> obiekt (bez pól plikowych). */
export function formObject(fd) {
  const out = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

// ---------- elementy strony ----------

export function pageHeader(title, { subtitle, actions, back } = {}) {
  return h(
    'div',
    { class: 'page-header' },
    back ? h('a', { class: 'back-link', href: back.href }, '← ', back.label) : null,
    h(
      'div',
      { class: 'page-header-row' },
      h('div', {}, h('h1', { tabindex: '-1' }, title), subtitle ? h('p', { class: 'subtitle' }, subtitle) : null),
      actions ? h('div', { class: 'page-actions' }, actions) : null,
    ),
  );
}

export function emptyState({ title, text, action, iconName = 'gift' }) {
  return h(
    'div',
    { class: 'empty-state' },
    h('div', { class: 'empty-icon' }, icon(iconName)),
    h('h3', {}, title),
    text ? h('p', {}, text) : null,
    action || null,
  );
}

export function errorState(err) {
  return h('div', { class: 'alert alert-error', role: 'alert' }, err.message || 'Nie udało się wczytać danych.');
}

export function badge(text, variant = '') {
  return h('span', { class: `badge ${variant ? `badge-${variant}` : ''}` }, text);
}
