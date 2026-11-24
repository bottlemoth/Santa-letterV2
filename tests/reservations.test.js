'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, db, resetDb, registerUser, makeGroup, makeList, addItem } = require('./helpers');

const app = createApp();

async function setup() {
  const anna = await registerUser(app, 'Anna'); // właścicielka listy
  const piotr = await registerUser(app, 'Piotr');
  const kasia = await registerUser(app, 'Kasia');
  await makeGroup(anna, [piotr, kasia]);
  const list = await makeList(anna);
  const item = await addItem(anna, list.id, { name: 'Szalik' });
  return { anna, piotr, kasia, list, item };
}

describe('Zaklepywanie prezentów', () => {
  beforeEach(resetDb);
  after(() => db.pool.end());

  it('członek grupy może zaklepać prezent', async () => {
    const { piotr, item } = await setup();
    const res = await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(201);
    assert.equal(res.body.item.reservation.reservedBy.id, piotr.user.id);
    assert.equal(res.body.item.reservation.reservedBy.name, 'Piotr');
    assert.equal(res.body.item.reservation.isMine, true);
  });

  it('nie można zaklepać własnego prezentu', async () => {
    const { anna, item } = await setup();
    const res = await anna.post(`/api/items/${item.id}/reservation`, {}).expect(403);
    assert.equal(res.body.error, 'Nie możesz zaklepać prezentu z własnej listy.');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM reservations');
    assert.equal(rows[0].n, 0);
  });

  it('nie można zaklepać prezentu dwa razy', async () => {
    const { piotr, kasia, item } = await setup();
    await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(201);
    const res = await kasia.post(`/api/items/${item.id}/reservation`, {}).expect(409);
    assert.equal(res.body.error, 'Ten prezent został już zaklepany przez inną osobę.');
    await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(409);
    const { rows } = await db.query('SELECT reserver_id FROM reservations');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reserver_id, piotr.user.id);
  });

  it('równoczesne żądania: dokładnie jedna rezerwacja się udaje', async () => {
    const { anna, piotr, kasia, list } = await setup();
    const extra = [];
    for (let i = 0; i < 4; i += 1) extra.push(await registerUser(app, `Gosc${i}`));
    const g2 = await makeGroup(anna, extra, 'Znajomi');
    assert.ok(g2.id);
    const item = await addItem(anna, list.id, { name: 'Gorący towar' });
    const clients = [piotr, kasia, ...extra];
    const results = await Promise.all(clients.map((c) => c.post(`/api/items/${item.id}/reservation`, {})));
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 201).length, 1, `statusy: ${statuses}`);
    assert.equal(statuses.filter((s) => s === 409).length, clients.length - 1);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM reservations WHERE item_id = $1', [item.id]);
    assert.equal(rows[0].n, 1);
  });

  it('autor może anulować swoją rezerwację; inni nie mogą', async () => {
    const { piotr, kasia, item } = await setup();
    await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(201);
    const forbidden = await kasia.del(`/api/items/${item.id}/reservation`).expect(403);
    assert.equal(forbidden.body.error, 'Możesz anulować tylko własną rezerwację.');
    const res = await piotr.del(`/api/items/${item.id}/reservation`).expect(200);
    assert.equal(res.body.item.reservation, null);
    // po anulowaniu ktoś inny może zaklepać
    await kasia.post(`/api/items/${item.id}/reservation`, {}).expect(201);
  });

  it('inni członkowie widzą, że prezent jest zaklepany i przez kogo', async () => {
    const { piotr, kasia, list, item } = await setup();
    await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(201);
    const l = (await kasia.get(`/api/lists/${list.id}`).expect(200)).body.list;
    const it2 = l.items.find((x) => x.id === item.id);
    assert.deepEqual(it2.reservation.reservedBy, { id: piotr.user.id, name: 'Piotr' });
    assert.equal(it2.reservation.isMine, false);
  });

  it('rezerwacja jest globalna — lista widoczna w kilku grupach może być zaklepana tylko raz', async () => {
    const anna = await registerUser(app, 'Anna');
    const rodzina = await registerUser(app, 'Rodzina');
    const praca = await registerUser(app, 'Praca');
    await makeGroup(anna, [rodzina], 'Rodzina');
    await makeGroup(anna, [praca], 'Praca');
    const list = await makeList(anna);
    const item = await addItem(anna, list.id);
    await rodzina.post(`/api/items/${item.id}/reservation`, {}).expect(201);
    await praca.post(`/api/items/${item.id}/reservation`, {}).expect(409);
    const seen = (await praca.get(`/api/lists/${list.id}`).expect(200)).body.list.items[0];
    assert.equal(seen.reservation.reservedBy.name, 'Rodzina');
  });

  it('osoba spoza grup nie może zaklepać ani zobaczyć pozycji (404)', async () => {
    const { item } = await setup();
    const obcy = await registerUser(app, 'Obcy');
    const r = await obcy.post(`/api/items/${item.id}/reservation`, {}).expect(404);
    assert.equal(r.body.error, 'Nie znaleziono zasobu.');
    await obcy.del(`/api/items/${item.id}/reservation`).expect(404);
  });

  it('nie można zaklepać prezentu z listy zarchiwizowanej', async () => {
    const { anna, piotr, list, item } = await setup();
    await anna.patch(`/api/lists/${list.id}`, { status: 'archived' }).expect(200);
    await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(409);
  });

  it('usunięcie zaklepanej pozycji powiadamia rezerwującego (nie właściciela)', async () => {
    const { anna, piotr, item } = await setup();
    await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(201);
    await anna.del(`/api/items/${item.id}`).expect(204);
    const pn = (await piotr.get('/api/notifications').expect(200)).body.notifications;
    assert.ok(pn.some((n) => n.type === 'reserved_item_removed'));
    const an = (await anna.get('/api/notifications').expect(200)).body.notifications;
    assert.ok(!an.some((n) => n.type === 'reserved_item_removed'));
  });

  it('dashboard pokazuje moje zaklepane prezenty', async () => {
    const { piotr, item } = await setup();
    await piotr.post(`/api/items/${item.id}/reservation`, {}).expect(201);
    const d = (await piotr.get('/api/dashboard').expect(200)).body;
    assert.equal(d.myClaims.length, 1);
    assert.equal(d.myClaims[0].name, 'Szalik');
  });
});
