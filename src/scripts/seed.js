'use strict';

/**
 * Dane demonstracyjne. Skrypt jest idempotentny: usuwa wcześniejsze konta demo
 * (@example.com) wraz z powiązanymi danymi i tworzy je od nowa.
 *
 * Uruchomienie:  npm run seed   |   docker compose exec app npm run seed
 */
const bcrypt = require('bcryptjs');
const db = require('../db');

const PASSWORD = 'Mikolaj2024!';

const USERS = [
  { key: 'anna', name: 'Anna Kowalska', email: 'anna@example.com' },
  { key: 'piotr', name: 'Piotr Kowalski', email: 'piotr@example.com' },
  { key: 'kasia', name: 'Kasia Nowak', email: 'kasia@example.com' },
  { key: 'tomek', name: 'Tomek Wiśniewski', email: 'tomek@example.com' },
];

function isoInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextChristmas() {
  const now = new Date();
  const year = now.getMonth() === 11 && now.getDate() > 24 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-12-24`;
}

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12);

  await db.tx(async (c) => {
    // Grupy demo usuwamy jawnie (nie mają kaskady od użytkowników).
    await c.query(`DELETE FROM groups WHERE invite_code IN ('RODZINA1', 'PRACA234')`);
    await c.query(`DELETE FROM users WHERE email = ANY($1)`, [USERS.map((u) => u.email)]);

    const u = {};
    for (const user of USERS) {
      const { rows } = await c.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [user.name, user.email, hash],
      );
      u[user.key] = rows[0].id;
    }

    // ---------- grupy ----------
    const g1 = (
      await c.query(
        `INSERT INTO groups (name, description, kind, invite_code, created_by)
         VALUES ('Rodzina Kowalskich', 'Wigilia u babci Basi — losujemy, kupujemy, nie zdradzamy!', 'family', 'RODZINA1', $1) RETURNING id`,
        [u.anna],
      )
    ).rows[0].id;
    const g2 = (
      await c.query(
        `INSERT INTO groups (name, description, kind, invite_code, created_by)
         VALUES ('Znajomi z pracy', 'Świąteczna wymiana prezentów w biurze.', 'friends', 'PRACA234', $1) RETURNING id`,
        [u.kasia],
      )
    ).rows[0].id;
    const member = (g, uid, role = 'member') =>
      c.query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)', [g, uid, role]);
    await member(g1, u.anna, 'admin');
    await member(g1, u.piotr);
    await member(g1, u.kasia);
    await member(g2, u.kasia, 'admin');
    await member(g2, u.tomek);
    await member(g2, u.anna);

    // ---------- zwykła lista Anny ----------
    const annaList = (
      await c.query(
        `INSERT INTO gift_lists (owner_id, name, occasion, description, event_date, mode)
         VALUES ($1, 'Święta 2026', 'christmas', 'Kilka rzeczy, które sprawią mi radość pod choinką.', $2, 'standard') RETURNING id`,
        [u.anna, nextChristmas()],
      )
    ).rows[0].id;
    const item = async (listId, data) =>
      (
        await c.query(
          `INSERT INTO gift_items (list_id, name, url, image_url, notes, price, currency, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [listId, data.name, data.url || null, data.imageUrl || null, data.notes || null, data.price || null, data.currency || 'PLN', data.priority || 'medium'],
        )
      ).rows[0].id;
    const reader = await item(annaList, {
      name: 'Czytnik e-booków',
      url: 'https://example.com/czytnik',
      notes: 'Najlepiej z podświetleniem i wodoodporny.',
      price: '549.00',
      priority: 'high',
    });
    await item(annaList, { name: 'Kubek termiczny', notes: 'Kolor butelkowej zieleni, ok. 400 ml.', price: '89.99', priority: 'medium' });
    await item(annaList, { name: 'Książka „Opowieść wigilijna” — wydanie ilustrowane', price: '79.00', priority: 'low' });
    await item(annaList, { name: 'Kurs ceramiki dla początkujących', url: 'https://example.com/ceramika', price: '320.00', priority: 'high' });

    // Przykładowa rezerwacja: Piotr zaklepał czytnik (Anna tego nie widzi!).
    await c.query('INSERT INTO reservations (item_id, reserver_id) VALUES ($1, $2)', [reader, u.piotr]);

    // ---------- lista urodzinowa Piotra ----------
    const piotrList = (
      await c.query(
        `INSERT INTO gift_lists (owner_id, name, occasion, description, event_date)
         VALUES ($1, 'Moje 40. urodziny', 'birthday', 'Czterdziestka na karku — przyda się coś na rower.', $2) RETURNING id`,
        [u.piotr, isoInDays(10)],
      )
    ).rows[0].id;
    await item(piotrList, { name: 'Licznik rowerowy GPS', price: '699.00', priority: 'high' });
    await item(piotrList, { name: 'Rękawiczki rowerowe zimowe', notes: 'Rozmiar L', price: '129.00', priority: 'medium' });

    // ---------- lista w trybie niespodzianki (Kasia) ----------
    const kasiaList = (
      await c.query(
        `INSERT INTO gift_lists (owner_id, name, occasion, description, event_date, mode)
         VALUES ($1, 'Zaskoczcie mnie!', 'christmas', 'Nie lubię wybierać sama — zaufam Wam.', $2, 'surprise') RETURNING id`,
        [u.kasia, nextChristmas()],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO surprise_profiles (list_id, interests, categories, preferences, sizes, budget_min, budget_max, currency, dislikes, notes)
       VALUES ($1, 'Górskie wędrówki, fotografia analogowa, dobra kawa', 'Outdoor, książki podróżnicze, akcesoria do kawy',
               'Kolory ziemi, minimalizm, rzeczy praktyczne', 'Bluza M, buty 38', 100, 300, 'PLN',
               'Perfumy, słodycze, figurki', 'Wolę jedną porządną rzecz niż kilka drobiazgów.')`,
      [kasiaList],
    );
    // Tajny pomysł Tomka — Kasia go nie zobaczy.
    await c.query(
      `INSERT INTO secret_ideas (list_id, author_id, name, url, private_note)
       VALUES ($1, $2, 'Ręczny młynek do kawy', 'https://example.com/mlynek', 'Zamówię przed 15 grudnia.')`,
      [kasiaList, u.tomek],
    );

    // ---------- lista archiwalna ----------
    await c.query(
      `INSERT INTO gift_lists (owner_id, name, occasion, description, event_date, status)
       VALUES ($1, 'Rocznica ślubu 2025', 'anniversary', 'Zeszłoroczna lista.', '2025-06-14', 'archived')`,
      [u.anna],
    );

    // ---------- powiadomienia ----------
    const n = (uid, type, message, link = null) =>
      c.query('INSERT INTO notifications (user_id, type, message, link) VALUES ($1, $2, $3, $4)', [uid, type, message, link]);
    await n(u.anna, 'group_joined', 'Piotr Kowalski dołączył(a) do grupy „Rodzina Kowalskich”.', `/groups/${g1}`);
    await n(u.anna, 'group_joined', 'Kasia Nowak dołączył(a) do grupy „Rodzina Kowalskich”.', `/groups/${g1}`);
    await n(u.piotr, 'list_published', 'Anna Kowalska opublikował(a) nową listę „Święta 2026” (Boże Narodzenie).', `/lists/${annaList}`);
    await n(u.kasia, 'list_published', 'Anna Kowalska opublikował(a) nową listę „Święta 2026” (Boże Narodzenie).', `/lists/${annaList}`);
    await n(u.tomek, 'list_published', 'Kasia Nowak opublikował(a) nową listę „Zaskoczcie mnie!” (Boże Narodzenie).', `/lists/${kasiaList}`);
    await n(u.tomek, 'group_welcome', 'Dołączono do grupy „Znajomi z pracy”. Miłego obdarowywania!', `/groups/${g2}`);
  });

  console.log('[seed] Dane demonstracyjne gotowe.');
  console.log(`[seed] Konta (hasło: ${PASSWORD}): ${USERS.map((x) => x.email).join(', ')}`);
  console.log('[seed] Kody grup: RODZINA1 (Rodzina Kowalskich), PRACA234 (Znajomi z pracy)');
}

main()
  .catch((err) => {
    console.error('[seed] Błąd:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
