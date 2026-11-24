'use strict';

const { z } = require('zod');
const { notFound } = require('../middleware/errors');

// Polskie komunikaty domyślne Zoda (dla przypadków bez własnego komunikatu).
z.config(z.locales.pl());

// ---------- pomocnicze normalizatory ----------

const trimOrNull = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
};

const requiredText = (label, max) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z
      .string({ error: `Pole „${label}” jest wymagane.` })
      .min(1, `Pole „${label}” jest wymagane.`)
      .max(max, `Pole „${label}” może mieć maksymalnie ${max} znaków.`),
  );

const optionalText = (label, max) =>
  z
    .preprocess(
      trimOrNull,
      z
        .string({ error: `Pole „${label}” ma nieprawidłową wartość.` })
        .max(max, `Pole „${label}” może mieć maksymalnie ${max} znaków.`)
        .nullable(),
    )
    .optional();

function isHttpUrl(value, { httpsOnly = false } = {}) {
  try {
    const u = new URL(value);
    if (httpsOnly) return u.protocol === 'https:';
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const optionalUrl = (label, opts = {}) =>
  z
    .preprocess(
      trimOrNull,
      z
        .string()
        .max(2048, `Pole „${label}” jest zbyt długie.`)
        .refine((v) => isHttpUrl(v, opts), {
          message: opts.httpsOnly
            ? `Pole „${label}” musi być poprawnym adresem zaczynającym się od https://`
            : `Pole „${label}” musi być poprawnym adresem http:// lub https://`,
        })
        .nullable(),
    )
    .optional();

const money = (label) =>
  z
    .preprocess(
      (v) => {
        if (v === undefined) return undefined;
        if (v === null || v === '') return null;
        if (typeof v === 'number') return String(v);
        if (typeof v === 'string') return v.trim().replace(/\s/g, '').replace(',', '.');
        return v;
      },
      z
        .string()
        .regex(/^\d{1,8}(\.\d{1,2})?$/, `Pole „${label}” musi być kwotą, np. 149,99.`)
        .nullable(),
    )
    .optional();

const currency = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() || undefined : v),
    z.string().regex(/^[A-Z]{3}$/, 'Waluta musi być trzyliterowym kodem, np. PLN.'),
  )
  .optional();

const boolish = z
  .preprocess((v) => {
    if (v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'on', 'yes'].includes(String(v).toLowerCase());
  }, z.boolean())
  .optional();

const email = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z
    .string({ error: 'Adres e-mail jest wymagany.' })
    .min(1, 'Adres e-mail jest wymagany.')
    .max(254, 'Adres e-mail jest zbyt długi.')
    .pipe(z.email('Podaj poprawny adres e-mail.')),
);

const newPassword = z
  .string({ error: 'Hasło jest wymagane.' })
  .min(8, 'Hasło musi mieć co najmniej 8 znaków.')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Hasło może mieć maksymalnie 72 bajty.');

const dateString = z
  .preprocess(
    trimOrNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data musi mieć format RRRR-MM-DD.')
      .refine((v) => {
        const d = new Date(`${v}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
      }, 'Podaj poprawną datę.')
      .nullable(),
  )
  .optional();

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Parsuje ID z parametru ścieżki; niepoprawne ID traktujemy jak nieistniejący zasób. */
function parseId(value) {
  const r = id.safeParse(value);
  if (!r.success) throw notFound();
  return r.data;
}

// ---------- schematy ----------

const register = z.object({
  name: requiredText('Imię lub nazwa', 80),
  email,
  password: newPassword,
});

const login = z.object({
  email,
  password: z.string({ error: 'Hasło jest wymagane.' }).min(1, 'Hasło jest wymagane.').max(200),
});

const profileUpdate = z.object({
  name: requiredText('Imię lub nazwa', 80).optional(),
  email: email.optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: newPassword.optional().or(z.literal('').transform(() => undefined)),
});

const groupKind = z.enum(['family', 'friends'], { error: 'Wybierz rodzaj grupy: rodzina lub znajomi.' });

const groupCreate = z.object({
  name: requiredText('Nazwa grupy', 80),
  description: optionalText('Opis', 500),
  kind: groupKind.default('family'),
});

const groupUpdate = z.object({
  name: requiredText('Nazwa grupy', 80).optional(),
  description: optionalText('Opis', 500),
  kind: groupKind.optional(),
});

const joinGroup = z.object({
  code: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '').toUpperCase() : v),
    z
      .string({ error: 'Podaj kod zaproszenia.' })
      .min(1, 'Podaj kod zaproszenia.')
      .regex(/^[A-Z0-9]{6,16}$/, 'Kod zaproszenia ma nieprawidłowy format.'),
  ),
});

const transferOwnership = z.object({
  userId: id,
});

const occasion = z.enum(['christmas', 'birthday', 'anniversary', 'other'], { error: 'Wybierz okazję.' });
const listStatus = z.enum(['active', 'archived'], { error: 'Nieprawidłowy status listy.' });

const listCreate = z.object({
  name: requiredText('Nazwa listy', 120),
  occasion: occasion.default('christmas'),
  occasionLabel: optionalText('Nazwa okazji', 80),
  description: optionalText('Opis', 1000),
  eventDate: dateString,
  status: listStatus.default('active'),
  mode: z.enum(['standard', 'surprise'], { error: 'Nieprawidłowy tryb listy.' }).default('standard'),
});

const listUpdate = z.object({
  name: requiredText('Nazwa listy', 120).optional(),
  occasion: occasion.optional(),
  occasionLabel: optionalText('Nazwa okazji', 80),
  description: optionalText('Opis', 1000),
  eventDate: dateString,
  status: listStatus.optional(),
});

const surpriseProfile = z
  .object({
    interests: optionalText('Zainteresowania', 1000),
    categories: optionalText('Kategorie', 1000),
    preferences: optionalText('Preferencje', 1000),
    sizes: optionalText('Rozmiary', 500),
    budgetMin: money('Budżet od'),
    budgetMax: money('Budżet do'),
    currency,
    dislikes: optionalText('Czego nie chcę', 1000),
    notes: optionalText('Uwagi', 1000),
  })
  .refine((d) => !d.budgetMin || !d.budgetMax || Number(d.budgetMin) <= Number(d.budgetMax), {
    message: 'Budżet „od” nie może być większy niż budżet „do”.',
    path: ['budgetMax'],
  });

const priority = z.enum(['low', 'medium', 'high'], { error: 'Wybierz priorytet: niski, średni lub wysoki.' });

const itemFields = {
  url: optionalUrl('Link do produktu'),
  imageUrl: optionalUrl('Adres zdjęcia', { httpsOnly: true }),
  notes: optionalText('Uwagi', 1000),
  price: money('Cena'),
  currency,
  priority: priority.optional(),
  removeImage: boolish,
};

const itemCreate = z.object({ name: requiredText('Nazwa prezentu', 200), ...itemFields });
const itemUpdate = z.object({ name: requiredText('Nazwa prezentu', 200).optional(), ...itemFields });

const ideaFields = {
  url: optionalUrl('Link'),
  imageUrl: optionalUrl('Adres zdjęcia', { httpsOnly: true }),
  privateNote: optionalText('Prywatna uwaga', 1000),
  removeImage: boolish,
};
const ideaCreate = z.object({ name: requiredText('Nazwa pomysłu', 200), ...ideaFields });
const ideaUpdate = z.object({ name: requiredText('Nazwa pomysłu', 200).optional(), ...ideaFields });

module.exports = {
  parseId,
  isHttpUrl,
  register,
  login,
  profileUpdate,
  groupCreate,
  groupUpdate,
  joinGroup,
  transferOwnership,
  listCreate,
  listUpdate,
  surpriseProfile,
  itemCreate,
  itemUpdate,
  ideaCreate,
  ideaUpdate,
};
