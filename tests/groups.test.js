'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, db, resetDb, registerUser, makeGroup, makeList } = require('./helpers');

const app = createApp();

describe('Grupy: tworzenie, dołączanie, role', () => {
  beforeEach(resetDb);
  after(() => db.pool.end());

  it('tworzy grupę z kodem zaproszenia; twórca jest administratorem', async () => {
    const anna = await registerUser(app, 'Anna');
    const res = await anna.post('/api/groups', { name: ' Rodzina ', description: 'Święta u babci', kind: 'family' }).expect(201);
    const g = res.body.group;
    assert.equal(g.name, 'Rodzina');
    assert.equal(g.role, 'admin');
    assert.match(g.inviteCode, /^[A-Z0-9]{8}$/);
    assert.equal(g.members.length, 1);
  });

  it('pozwala dołączyć kodem (niezależnie od wielkości liter i spacji) i powiadamia członków', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    const g = (await anna.post('/api/groups', { name: 'Rodzina' }).expect(201)).body.group;
    const code = `  ${g.inviteCode.slice(0, 4).toLowerCase()} ${g.inviteCode.slice(4)} `;
    const res = await piotr.post('/api/groups/join', { code }).expect(201);
    assert.equal(res.body.group.id, g.id);
    assert.equal(res.body.group.role, 'member');
    assert.equal(res.body.group.members.length, 2);

    const again = await piotr.post('/api/groups/join', { code: g.inviteCode }).expect(409);
    assert.equal(again.body.error, 'Już należysz do tej grupy.');

    const n = await anna.get('/api/notifications').expect(200);
    assert.ok(n.body.notifications.some((x) => x.type === 'group_joined' && x.message.includes('Piotr')));
  });

  it('odrzuca nieistniejący lub niepoprawny kod', async () => {
    const piotr = await registerUser(app, 'Piotr');
    const r1 = await piotr.post('/api/groups/join', { code: 'ZZZZZZZZ' }).expect(404);
    assert.match(r1.body.error, /Nie znaleziono grupy/);
    const r2 = await piotr.post('/api/groups/join', { code: '<script>' }).expect(400);
    assert.match(r2.body.fields.code, /nieprawidłowy format/);
  });

  it('nie-członek nie widzi grupy ani jej członków (404)', async () => {
    const anna = await registerUser(app, 'Anna');
    const obcy = await registerUser(app, 'Obcy');
    const g = await makeGroup(anna);
    const res = await obcy.get(`/api/groups/${g.id}`).expect(404);
    assert.equal(res.body.error, 'Nie znaleziono zasobu.');
    await obcy.patch(`/api/groups/${g.id}`, { name: 'Przejęta' }).expect(404);
    await obcy.post(`/api/groups/${g.id}/invite-code`, {}).expect(404);
    const list = (await obcy.get('/api/groups').expect(200)).body.groups;
    assert.equal(list.length, 0);
  });

  it('tylko administrator edytuje grupę, generuje kod i usuwa członków', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    const kasia = await registerUser(app, 'Kasia');
    const g = await makeGroup(anna, [piotr, kasia]);

    await piotr.patch(`/api/groups/${g.id}`, { name: 'Moja' }).expect(403);
    await piotr.post(`/api/groups/${g.id}/invite-code`, {}).expect(403);
    await piotr.del(`/api/groups/${g.id}/members/${kasia.user.id}`).expect(403);

    const upd = await anna.patch(`/api/groups/${g.id}`, { name: 'Kowalscy', description: '' }).expect(200);
    assert.equal(upd.body.group.name, 'Kowalscy');
    assert.equal(upd.body.group.description, null);

    const newCode = (await anna.post(`/api/groups/${g.id}/invite-code`, {}).expect(200)).body.inviteCode;
    assert.notEqual(newCode, g.inviteCode);
    const nowy = await registerUser(app, 'Nowy');
    await nowy.post('/api/groups/join', { code: g.inviteCode }).expect(404);
    await nowy.post('/api/groups/join', { code: newCode }).expect(201);

    const rm = await anna.del(`/api/groups/${g.id}/members/${kasia.user.id}`).expect(200);
    assert.ok(!rm.body.group.members.some((m) => m.id === kasia.user.id));
    await kasia.get(`/api/groups/${g.id}`).expect(404);
    const n = await kasia.get('/api/notifications').expect(200);
    assert.ok(n.body.notifications.some((x) => x.type === 'group_removed'));
  });

  it('administrator musi przekazać własność przed opuszczeniem grupy', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    const g = await makeGroup(anna, [piotr]);

    const blocked = await anna.post(`/api/groups/${g.id}/leave`, {}).expect(409);
    assert.match(blocked.body.error, /przekaż jej własność/);

    await piotr.post(`/api/groups/${g.id}/transfer`, { userId: piotr.user.id }).expect(403);
    const t = await anna.post(`/api/groups/${g.id}/transfer`, { userId: piotr.user.id }).expect(200);
    assert.equal(t.body.group.role, 'member');
    assert.equal(t.body.group.members.find((m) => m.id === piotr.user.id).role, 'admin');

    await anna.post(`/api/groups/${g.id}/leave`, {}).expect(200);
    await anna.get(`/api/groups/${g.id}`).expect(404);

    // ostatni członek-admin opuszcza => grupa zostaje usunięta
    const last = await piotr.post(`/api/groups/${g.id}/leave`, {}).expect(200);
    assert.equal(last.body.groupDeleted, true);
  });

  it('nie można przekazać własności osobie spoza grupy', async () => {
    const anna = await registerUser(app, 'Anna');
    const obcy = await registerUser(app, 'Obcy');
    const g = await makeGroup(anna);
    await anna.post(`/api/groups/${g.id}/transfer`, { userId: obcy.user.id }).expect(400);
  });

  it('listy są widoczne tylko dla członków wspólnych grup; opuszczenie grupy odbiera dostęp', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    const obcy = await registerUser(app, 'Obcy');
    const g = await makeGroup(anna, [piotr]);
    const list = await makeList(anna);

    await piotr.get(`/api/lists/${list.id}`).expect(200);
    await piotr.get(`/api/users/${anna.user.id}/lists`).expect(200);
    await obcy.get(`/api/lists/${list.id}`).expect(404);
    await obcy.get(`/api/users/${anna.user.id}/lists`).expect(404);

    await piotr.post(`/api/groups/${g.id}/leave`, {}).expect(200);
    await piotr.get(`/api/lists/${list.id}`).expect(404);
  });

  it('użytkownik może należeć do wielu grup', async () => {
    const anna = await registerUser(app, 'Anna');
    const piotr = await registerUser(app, 'Piotr');
    await makeGroup(anna, [piotr], 'Rodzina');
    await makeGroup(piotr, [anna], 'Praca');
    const groups = (await anna.get('/api/groups').expect(200)).body.groups;
    assert.deepEqual(groups.map((g) => g.name).sort(), ['Praca', 'Rodzina']);
  });
});
