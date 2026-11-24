'use strict';

/**
 * KRYTYCZNE: ochrona niespodzianki.
 *
 * Strategia: zbieramy KAŻDĄ odpowiedź, którą właściciel listy może uzyskać,
 * w stanie "bez rezerwacji" i "z rezerwacją / tajnym pomysłem", a następnie
 * sprawdzamy, że są BAJT W BAJT identyczne oraz że nie zawierają żadnych
 * kluczy ani wartości zdradzających rezerwację.
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, db, resetDb, registerUser, makeGroup, makeList, addItem, allKeys } = require('./helpers');

const app = createApp();

const FORBIDDEN_KEY = /reserv|idea/i;

/** Wszystkie odpowiedzi widoczne dla właściciela, istotne dla jego list. */
async function ownerSnapshot(owner, ctx) {
  const snap = {};
  const take = async (label, req) => {
    const res = await req;
    snap[label] = { status: res.status, body: res.body };
  };
  await take('list', owner.get(`/api/lists/${ctx.list.id}`));
  await take('surpriseList', owner.get(`/api/lists/${ctx.surpriseList.id}`));
  await take('mine', owner.get('/api/lists/mine'));
  await take('userLists', owner.get(`/api/users/${owner.user.id}/lists`));
  await take('dashboard', owner.get('/api/dashboard'));
  await take('hiddenEndpoint', owner.get(`/api/lists/${ctx.surpriseList.id}/ideas`));
  await take('reserveOwn', owner.post(`/api/items/${ctx.item.id}/reservation`, {}));
  await take('cancelOwn', owner.del(`/api/items/${ctx.item.id}/reservation`));
  await take('reserveOther', owner.post(`/api/items/${ctx.item2.id}/reservation`, {}));
  await take('cancelOther', owner.del(`/api/items/${ctx.item2.id}/reservation`));
  const notifs = await owner.get('/api/notifications');
  snap.notifications = { status: notifs.status, body: notifs.body };
  return snap;
}

async function setup() {
  const anna = await registerUser(app, 'Anna'); // właścicielka
  const piotr = await registerUser(app, 'Piotr'); // rezerwujący
  const kasia = await registerUser(app, 'Kasia'); // obserwatorka
  await makeGroup(anna, [piotr, kasia]);
  const list = await makeList(anna, { name: 'Gwiazdka' });
  const item = await addItem(anna, list.id, { name: 'Rower', price: '1200' });
  const item2 = await addItem(anna, list.id, { name: 'Kask' });
  const surpriseList = await makeList(anna, {
    name: 'Zaskocz mnie',
    mode: 'surprise',
    surprise: { interests: 'Fotografia', dislikes: 'Skarpetki' },
  });
  return { anna, piotr, kasia, list, item, item2, surpriseList };
}

function assertNoLeak(snap, reserver) {
  // Powiadomienia mogą legalnie zawierać imię rezerwującego (np. „Piotr dołączył do grupy”) —
  // dla nich sprawdzamy równość przed/po, a imię skanujemy w pozostałych odpowiedziach.
  const { notifications, ...rest } = snap; // eslint-disable-line no-unused-vars
  const json = JSON.stringify(rest);
  // Skanujemy wyłącznie odpowiedzi serwera (wartości), nie etykiety migawki.
  for (const key of allKeys(Object.values(snap))) {
    assert.doesNotMatch(key, FORBIDDEN_KEY, `właściciel otrzymał klucz "${key}"`);
  }
  assert.ok(!json.includes(reserver.user.name), 'imię rezerwującego wyciekło do właściciela');
  assert.ok(!json.includes(reserver.email), 'e-mail rezerwującego wyciekł do właściciela');
  assert.ok(!json.includes('Lustrzanka'), 'nazwa tajnego pomysłu wyciekła do właściciela');
}

describe('Ochrona niespodzianki — brak wycieku do właściciela listy', () => {
  beforeEach(resetDb);
  after(() => db.pool.end());

  it('wszystkie odpowiedzi dla właściciela są identyczne przed i po rezerwacji oraz dodaniu tajnego pomysłu', async () => {
    const ctx = await setup();
    // Odczytanie powiadomień zanim zrobimy migawkę, by stan był stabilny.
    await ctx.anna.get('/api/notifications');

    const before = await ownerSnapshot(ctx.anna, ctx);

    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    await ctx.piotr
      .post(`/api/lists/${ctx.surpriseList.id}/ideas`, { name: 'Lustrzanka', privateNote: 'kupię w grudniu' })
      .expect(201);

    const afterSnap = await ownerSnapshot(ctx.anna, ctx);

    assert.deepEqual(afterSnap, before, 'odpowiedzi dla właściciela różnią się po rezerwacji');
    assertNoLeak(afterSnap, ctx.piotr);
    // „myClaims” to wyłącznie rezerwacje dokonane PRZEZ właściciela — tu pusta lista.
    assert.deepEqual(afterSnap.dashboard.body.myClaims, []);
    // Właściciel nie może zaklepać ani anulować — stała odpowiedź 403 bez szczegółów.
    assert.equal(afterSnap.reserveOwn.status, 403);
    assert.equal(afterSnap.hiddenEndpoint.status, 404);
  });

  it('widok listy właściciela nie zawiera pola reservation ani ideas', async () => {
    const ctx = await setup();
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    const l = (await ctx.anna.get(`/api/lists/${ctx.list.id}`).expect(200)).body.list;
    assert.equal(l.isOwner, true);
    for (const item of l.items) {
      assert.equal(Object.hasOwn(item, 'reservation'), false);
    }
    assert.equal(Object.hasOwn(l, 'ideas'), false);
    // a gość widzi rezerwację
    const g = (await ctx.kasia.get(`/api/lists/${ctx.list.id}`).expect(200)).body.list;
    assert.equal(g.items.find((i) => i.id === ctx.item.id).reservation.reservedBy.name, 'Piotr');
  });

  it('próby bezpośredniego odpytania o rezerwację przez właściciela dają stałą odpowiedź', async () => {
    const ctx = await setup();
    const free1 = await ctx.anna.post(`/api/items/${ctx.item.id}/reservation`, {});
    const free2 = await ctx.anna.del(`/api/items/${ctx.item.id}/reservation`);
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    const taken1 = await ctx.anna.post(`/api/items/${ctx.item.id}/reservation`, {});
    const taken2 = await ctx.anna.del(`/api/items/${ctx.item.id}/reservation`);
    assert.deepEqual([taken1.status, taken1.body], [free1.status, free1.body]);
    assert.deepEqual([taken2.status, taken2.body], [free2.status, free2.body]);
    assert.equal(free1.status, 403);
  });

  it('odpowiedzi po edycji listy i pozycji nie zawierają ukrytych danych', async () => {
    const ctx = await setup();
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    const p1 = await ctx.anna.patch(`/api/items/${ctx.item.id}`, { notes: 'Rozmiar M' }).expect(200);
    const p2 = await ctx.anna.patch(`/api/items/${ctx.item2.id}`, { notes: 'Rozmiar M' }).expect(200);
    assert.deepEqual(Object.keys(p1.body.item).sort(), Object.keys(p2.body.item).sort());
    const p3 = await ctx.anna.patch(`/api/lists/${ctx.list.id}`, { description: 'Nowy opis' }).expect(200);
    const p4 = await ctx.anna.put(`/api/lists/${ctx.surpriseList.id}/surprise`, { interests: 'Rower' }).expect(200);
    assertNoLeak({ p1: p1.body, p2: p2.body, p3: p3.body, p4: p4.body }, ctx.piotr);
  });

  it('rezerwacja nie zmienia znaczników czasu widocznych dla właściciela', async () => {
    const ctx = await setup();
    const before = (await ctx.anna.get(`/api/lists/${ctx.list.id}`)).body.list;
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    await ctx.piotr.del(`/api/items/${ctx.item.id}/reservation`).expect(200);
    await ctx.kasia.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    const afterList = (await ctx.anna.get(`/api/lists/${ctx.list.id}`)).body.list;
    assert.equal(afterList.updatedAt, before.updatedAt);
    assert.deepEqual(afterList.items.map((i) => i.updatedAt), before.items.map((i) => i.updatedAt));
  });

  it('usunięcie pozycji zaklepanej i niezaklepanej daje właścicielowi identyczną odpowiedź', async () => {
    const ctx = await setup();
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    const a = await ctx.anna.del(`/api/items/${ctx.item.id}`);
    const b = await ctx.anna.del(`/api/items/${ctx.item2.id}`);
    assert.equal(a.status, 204);
    assert.deepEqual([a.status, a.text], [b.status, b.text]);
  });

  it('powiadomienia właściciela nie zdradzają rezerwacji ani pomysłów', async () => {
    const ctx = await setup();
    const before = (await ctx.anna.get('/api/notifications')).body;
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    await ctx.kasia.post(`/api/lists/${ctx.surpriseList.id}/ideas`, { name: 'Lustrzanka' }).expect(201);
    await ctx.piotr.del(`/api/items/${ctx.item.id}/reservation`).expect(200);
    const afterN = (await ctx.anna.get('/api/notifications')).body;
    assert.deepEqual(afterN, before);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND (type ILIKE '%reserv%' OR type ILIKE '%idea%')`,
      [ctx.anna.user.id],
    );
    assert.equal(rows[0].n, 0);
  });

  it('usunięcie listy z rezerwacjami nie wysyła właścicielowi informacji o rezerwujących', async () => {
    const ctx = await setup();
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    const before = (await ctx.anna.get('/api/notifications')).body;
    await ctx.anna.del(`/api/lists/${ctx.list.id}`).expect(204);
    const afterN = (await ctx.anna.get('/api/notifications')).body;
    assert.deepEqual(afterN, before);
    const pn = (await ctx.piotr.get('/api/notifications')).body.notifications;
    assert.ok(pn.some((n) => n.type === 'list_deleted'));
  });

  it('członkowie grupy widzą listę członków, ale bez danych o rezerwacjach', async () => {
    const ctx = await setup();
    await ctx.piotr.post(`/api/items/${ctx.item.id}/reservation`, {}).expect(201);
    const groups = (await ctx.anna.get('/api/groups')).body.groups;
    const g = (await ctx.anna.get(`/api/groups/${groups[0].id}`)).body.group;
    for (const k of allKeys(g)) assert.doesNotMatch(k, FORBIDDEN_KEY);
  });
});
