'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, db, resetDb, registerUser, makeGroup, makeList, addItem, PNG_1PX } = require('./helpers');

const app = createApp();
after(() => db.pool.end());

async function setup() {
  const kasia = await registerUser(app, 'Kasia'); // właścicielka listy-niespodzianki
  const tomek = await registerUser(app, 'Tomek'); // autor pomysłu
  const piotr = await registerUser(app, 'Piotr'); // inny członek
  await makeGroup(kasia, [tomek, piotr]);
  const list = await makeList(kasia, {
    name: 'Zaskoczcie mnie',
    occasion: 'birthday',
    mode: 'surprise',
    surprise: {
      interests: 'Wspinaczka, kawa',
      categories: 'Sport, książki',
      preferences: 'Kolory ziemi',
      sizes: 'M, but 38',
      budgetMin: '100',
      budgetMax: '300',
      dislikes: 'Perfumy',
      notes: 'Lubię rzeczy praktyczne',
    },
  });
  return { kasia, tomek, piotr, list };
}

describe('Tryb niespodzianki i tajne pomysły', () => {
  beforeEach(resetDb);


  it('członkowie widzą profil preferencji listy-niespodzianki', async () => {
    const { tomek, list } = await setup();
    const l = (await tomek.get(`/api/lists/${list.id}`).expect(200)).body.list;
    assert.equal(l.mode, 'surprise');
    assert.equal(l.surprise.sizes, 'M, but 38');
    assert.equal(l.surprise.dislikes, 'Perfumy');
    assert.deepEqual(l.ideas, []);
  });

  it('właściciel aktualizuje profil; budżet jest walidowany', async () => {
    const { kasia, list } = await setup();
    const bad = await kasia.put(`/api/lists/${list.id}/surprise`, { budgetMin: '500', budgetMax: '100' }).expect(400);
    assert.ok(bad.body.fields.budgetMax);
    const ok = await kasia.put(`/api/lists/${list.id}/surprise`, { interests: 'Joga' }).expect(200);
    assert.equal(ok.body.list.surprise.interests, 'Joga');
  });

  it('inny członek tworzy tajny pomysł, który jest automatycznie zaklepany przez autora', async () => {
    const { tomek, piotr, list } = await setup();
    const res = await tomek
      .form('post', `/api/lists/${list.id}/ideas`)
      .field('name', 'Uprząż wspinaczkowa')
      .field('url', 'https://example.com/uprzaz')
      .field('privateNote', 'Rozmiar M, kupię w sklepie górskim')
      .attach('image', PNG_1PX, { filename: 'u.png' })
      .expect(201);
    const idea = res.body.idea;
    assert.equal(idea.author.name, 'Tomek');
    assert.equal(idea.isMine, true);
    assert.equal(idea.privateNote, 'Rozmiar M, kupię w sklepie górskim');
    assert.match(idea.image, /^\/uploads\//);

    const forPiotr = (await piotr.get(`/api/lists/${list.id}`).expect(200)).body.list;
    assert.equal(forPiotr.ideas.length, 1);
    assert.equal(forPiotr.ideas[0].author.name, 'Tomek', 'inni widzą, kto „zaklepał” pomysł');
    assert.equal(forPiotr.ideas[0].privateNote, null, 'prywatna uwaga tylko dla autora');
  });

  it('tajne pomysły są całkowicie ukryte przed właścicielem listy', async () => {
    const { kasia, tomek, list } = await setup();
    const before = (await kasia.get(`/api/lists/${list.id}`).expect(200)).body;
    const idea = (await tomek.post(`/api/lists/${list.id}/ideas`, { name: 'Kubek termiczny' }).expect(201)).body.idea;
    const afterRes = (await kasia.get(`/api/lists/${list.id}`).expect(200)).body;
    assert.deepEqual(afterRes, before);
    assert.ok(!JSON.stringify(afterRes).includes('Kubek termiczny'));

    // bezpośrednie endpointy: zachowują się jak dla nieistniejącego zasobu
    const nonexistent = await kasia.get('/api/lists/999999/ideas');
    const r1 = await kasia.get(`/api/lists/${list.id}/ideas`);
    assert.deepEqual([r1.status, r1.body], [nonexistent.status, nonexistent.body]);
    assert.equal(r1.status, 404);

    const ghost = await kasia.patch('/api/ideas/999999', { name: 'x' });
    const r2 = await kasia.patch(`/api/ideas/${idea.id}`, { name: 'Przejęty' });
    assert.deepEqual([r2.status, r2.body], [ghost.status, ghost.body]);
    const r3 = await kasia.del(`/api/ideas/${idea.id}`);
    assert.equal(r3.status, 404);
    await kasia.post(`/api/lists/${list.id}/ideas`, { name: 'Sama sobie' }).expect(404);

    const { rows } = await db.query('SELECT name FROM secret_ideas WHERE id = $1', [idea.id]);
    assert.equal(rows[0].name, 'Kubek termiczny', 'pomysł nienaruszony');
  });

  it('autor może edytować i usunąć pomysł; inni członkowie nie', async () => {
    const { tomek, piotr, list } = await setup();
    const idea = (await tomek.post(`/api/lists/${list.id}/ideas`, { name: 'Książka' }).expect(201)).body.idea;
    await piotr.patch(`/api/ideas/${idea.id}`, { name: 'Moja' }).expect(403);
    await piotr.del(`/api/ideas/${idea.id}`).expect(403);
    const upd = await tomek.patch(`/api/ideas/${idea.id}`, { name: 'Książka o Tatrach' }).expect(200);
    assert.equal(upd.body.idea.name, 'Książka o Tatrach');
    await tomek.del(`/api/ideas/${idea.id}`).expect(204);
    const l = (await piotr.get(`/api/lists/${list.id}`).expect(200)).body.list;
    assert.equal(l.ideas.length, 0);
  });

  it('osoba spoza grupy nie widzi ani nie dodaje pomysłów', async () => {
    const { tomek, list } = await setup();
    const obcy = await registerUser(app, 'Obcy');
    const idea = (await tomek.post(`/api/lists/${list.id}/ideas`, { name: 'Lampka' }).expect(201)).body.idea;
    await obcy.get(`/api/lists/${list.id}/ideas`).expect(404);
    await obcy.post(`/api/lists/${list.id}/ideas`, { name: 'X' }).expect(404);
    await obcy.patch(`/api/ideas/${idea.id}`, { name: 'X' }).expect(404);
    await obcy.del(`/api/ideas/${idea.id}`).expect(404);
  });

  it('pomysłów nie można dodawać do zwykłych list', async () => {
    const { kasia, tomek } = await setup();
    const normal = await makeList(kasia, { name: 'Zwykła' });
    await addItem(kasia, normal.id);
    await tomek.post(`/api/lists/${normal.id}/ideas`, { name: 'X' }).expect(400);
  });
});

describe('Ochrona przed odczytem cudzych danych', () => {
  beforeEach(resetDb);


  it('niepoprawne lub cudze identyfikatory zawsze dają 404, bez szczegółów', async () => {
    const anna = await registerUser(app, 'Anna');
    const obcy = await registerUser(app, 'Obcy');
    const list = await makeList(anna);
    const item = await addItem(anna, list.id);
    for (const url of [
      `/api/lists/${list.id}`,
      `/api/users/${anna.user.id}/lists`,
      '/api/lists/abc',
      "/api/lists/1%20OR%201=1",
      '/api/lists/-1',
      '/api/lists/99999999999999999999',
    ]) {
      const r = await obcy.get(url);
      assert.equal(r.status, 404, url);
      assert.deepEqual(r.body, { error: 'Nie znaleziono zasobu.' }, url);
    }
    await obcy.post(`/api/items/${item.id}/reservation`, {}).expect(404);
  });

  it('nie da się podszyć pod innego użytkownika przez parametry w treści żądania', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    await makeGroup(anna, [piotr]);
    const list = await makeList(anna);
    const item = await addItem(anna, list.id);
    // Piotr próbuje utworzyć listę "jako Anna" i zaklepać "jako ktoś inny"
    const l = (await piotr.post('/api/lists', { name: 'Podróbka', ownerId: anna.user.id, owner_id: anna.user.id }).expect(201)).body.list;
    assert.equal(l.owner.id, piotr.user.id);
    const r = await piotr.post(`/api/items/${item.id}/reservation`, { reserverId: anna.user.id, userId: anna.user.id }).expect(201);
    assert.equal(r.body.item.reservation.reservedBy.id, piotr.user.id);
  });
});
