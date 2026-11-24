'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, db, resetDb, registerUser, makeGroup, makeList, addItem, PNG_1PX } = require('./helpers');
const config = require('../src/config');

const app = createApp();

describe('Listy prezentowe i pozycje', () => {
  beforeEach(resetDb);
  after(() => db.pool.end());

  it('tworzy wiele list na różne okazje', async () => {
    const anna = await registerUser(app, 'Anna');
    await makeList(anna, { name: 'Święta', occasion: 'christmas', eventDate: '2026-12-24' });
    await makeList(anna, { name: 'Urodziny', occasion: 'birthday', description: 'Trzydziestka!' });
    await makeList(anna, { name: 'Imieniny', occasion: 'other', occasionLabel: 'Imieniny', status: 'archived' });
    const mine = (await anna.get('/api/lists/mine').expect(200)).body.lists;
    assert.equal(mine.length, 3);
    assert.equal(mine.find((l) => l.name === 'Święta').eventDate, '2026-12-24');
  });

  it('waliduje dane listy', async () => {
    const anna = await registerUser(app, 'Anna');
    const r = await anna.post('/api/lists', { name: '', occasion: 'wakacje', eventDate: '2026-02-30' }).expect(400);
    assert.ok(r.body.fields.name);
    assert.ok(r.body.fields.occasion);
    assert.equal(r.body.fields.eventDate, 'Podaj poprawną datę.');
  });

  it('dodaje, edytuje i usuwa pozycje z normalizacją danych', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna);
    const item = await addItem(anna, list.id, {
      name: '  Czytnik e-booków ',
      url: 'https://example.com/czytnik',
      price: '499,99',
      priority: 'high',
      notes: 'Wersja z podświetleniem',
    });
    assert.equal(item.name, 'Czytnik e-booków');
    assert.equal(item.price, '499.99');
    assert.equal(item.currency, 'PLN');

    const upd = await anna.patch(`/api/items/${item.id}`, { price: '', currency: 'eur', priority: 'low' }).expect(200);
    assert.equal(upd.body.item.price, null);
    assert.equal(upd.body.item.currency, 'EUR');
    assert.equal(upd.body.item.priority, 'low');
    assert.equal(upd.body.item.name, 'Czytnik e-booków');

    await anna.del(`/api/items/${item.id}`).expect(204);
    const l = (await anna.get(`/api/lists/${list.id}`).expect(200)).body.list;
    assert.equal(l.items.length, 0);
  });

  it('odrzuca niebezpieczne adresy URL (np. javascript:)', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna);
    const r = await anna.post(`/api/lists/${list.id}/items`, { name: 'X', url: 'javascript:alert(1)' }).expect(400);
    assert.ok(r.body.fields.url);
    const r2 = await anna.post(`/api/lists/${list.id}/items`, { name: 'X', imageUrl: 'http://example.com/a.png' }).expect(400);
    assert.match(r2.body.fields.imageUrl, /https/);
  });

  it('przechowuje treść HTML jako zwykły tekst (frontend renderuje przez textContent)', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna);
    const item = await addItem(anna, list.id, { name: '<img src=x onerror=alert(1)>' });
    assert.equal(item.name, '<img src=x onerror=alert(1)>');
  });

  it('tylko właściciel może modyfikować listę i jej pozycje', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    const obcy = await registerUser(app, 'Obcy');
    await makeGroup(anna, [piotr]);
    const list = await makeList(anna);
    const item = await addItem(anna, list.id);

    // członek grupy: widzi, ale nie może zmieniać (403)
    await piotr.patch(`/api/lists/${list.id}`, { name: 'Hack' }).expect(403);
    await piotr.del(`/api/lists/${list.id}`).expect(403);
    await piotr.post(`/api/lists/${list.id}/items`, { name: 'Wciśnięty prezent' }).expect(403);
    await piotr.patch(`/api/items/${item.id}`, { name: 'Hack' }).expect(403);
    await piotr.del(`/api/items/${item.id}`).expect(403);

    // obcy: nie wie nawet, że zasób istnieje (404)
    await obcy.get(`/api/lists/${list.id}`).expect(404);
    await obcy.patch(`/api/lists/${list.id}`, { name: 'Hack' }).expect(404);
    await obcy.post(`/api/lists/${list.id}/items`, { name: 'X' }).expect(404);
    await obcy.patch(`/api/items/${item.id}`, { name: 'Hack' }).expect(404);
    await obcy.del(`/api/items/${item.id}`).expect(404);

    const fresh = (await anna.get(`/api/lists/${list.id}`).expect(200)).body.list;
    assert.equal(fresh.name, 'Święta 2026');
    assert.equal(fresh.items[0].name, 'Książka');
  });

  it('archiwizuje listę; trybu listy nie można zmienić', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna);
    const r = await anna.patch(`/api/lists/${list.id}`, { status: 'archived', eventDate: null }).expect(200);
    assert.equal(r.body.list.status, 'archived');
    await anna.patch(`/api/lists/${list.id}`, { mode: 'surprise' }).expect(400);
  });

  it('przyjmuje zdjęcie PNG i zapisuje je pod losową nazwą', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna);
    const res = await anna
      .form('post', `/api/lists/${list.id}/items`)
      .field('name', 'Kubek')
      .attach('image', PNG_1PX, { filename: '../../etc/passwd.png', contentType: 'image/png' })
      .expect(201);
    const img = res.body.item.image;
    assert.match(img, /^\/uploads\/[0-9a-f-]{36}\.png$/);
    assert.ok(fs.existsSync(path.join(config.uploadDir, path.basename(img))));
    // plik dostępny dla zalogowanych, z nagłówkiem nosniff
    const file = await anna.get(img).expect(200);
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
  });

  it('odrzuca plik udający obraz (zła sygnatura mimo nazwy i MIME)', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna);
    const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await anna
      .form('post', `/api/lists/${list.id}/items`)
      .field('name', 'Kubek')
      .attach('image', fake, { filename: 'kot.png', contentType: 'image/png' })
      .expect(400);
    assert.match(res.body.error, /Nieobsługiwany format zdjęcia/);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM gift_items');
    assert.equal(rows[0].n, 0);
  });

  it('odrzuca zbyt duży plik', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna);
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(config.maxUploadBytes + 1)]);
    const res = await anna
      .form('post', `/api/lists/${list.id}/items`)
      .field('name', 'Kubek')
      .attach('image', big, { filename: 'duzy.png', contentType: 'image/png' })
      .expect(413);
    assert.equal(res.body.error, 'Plik jest zbyt duży.');
  });

  it('niezalogowany nie pobierze przesłanych zdjęć', async () => {
    const request = require('supertest');
    await request(app).get('/uploads/00000000-0000-0000-0000-000000000000.png').expect(401);
  });

  it('do listy w trybie niespodzianki nie da się dodać konkretnych prezentów', async () => {
    const anna = await registerUser(app, 'Anna');
    const list = await makeList(anna, { mode: 'surprise', surprise: { interests: 'Góry, kawa', budgetMin: '50', budgetMax: '200' } });
    assert.equal(list.surprise.interests, 'Góry, kawa');
    assert.equal(list.surprise.budgetMax, '200.00');
    await anna.post(`/api/lists/${list.id}/items`, { name: 'X' }).expect(400);
  });

  it('powiadamia członków grup o opublikowaniu nowej listy', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    await makeGroup(anna, [piotr]);
    await makeList(anna, { name: 'Moje urodziny', occasion: 'birthday' });
    const n = (await piotr.get('/api/notifications').expect(200)).body;
    assert.ok(n.notifications.some((x) => x.type === 'list_published' && x.message.includes('Moje urodziny')));
    const own = (await anna.get('/api/notifications').expect(200)).body;
    assert.ok(!own.notifications.some((x) => x.type === 'list_published'));
  });

  it('obsługuje powiadomienia: odczyt pojedynczy i wszystkich; cudzych nie można oznaczyć', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    await makeGroup(anna, [piotr]);
    await makeList(anna, { name: 'A' });
    await makeList(anna, { name: 'B' });
    const n = (await piotr.get('/api/notifications').expect(200)).body;
    assert.ok(n.unreadCount >= 2);
    const first = n.notifications[0];
    await anna.post(`/api/notifications/${first.id}/read`, {}).expect(404);
    const r = await piotr.post(`/api/notifications/${first.id}/read`, {}).expect(200);
    assert.equal(r.body.notification.read, true);
    await piotr.post('/api/notifications/read-all', {}).expect(200);
    const after2 = (await piotr.get('/api/notifications/unread-count').expect(200)).body;
    assert.equal(after2.unreadCount, 0);
  });

  it('generuje przypomnienie o zbliżającej się okazji (bez duplikatów)', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    await makeGroup(anna, [piotr]);
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await makeList(anna, { name: 'Urodziny', occasion: 'birthday', eventDate: soon });
    await piotr.get('/api/notifications').expect(200);
    const n = (await piotr.get('/api/notifications').expect(200)).body.notifications;
    assert.equal(n.filter((x) => x.type === 'upcoming_occasion').length, 1);
    const own = (await anna.get('/api/notifications').expect(200)).body.notifications;
    assert.equal(own.filter((x) => x.type === 'upcoming_occasion').length, 0);
  });
});
