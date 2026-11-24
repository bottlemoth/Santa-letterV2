'use strict';

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp, db, resetDb, newClient, registerUser } = require('./helpers');

const app = createApp();

describe('Rejestracja i logowanie', () => {
  before(resetDb);
  beforeEach(resetDb);
  after(() => db.pool.end());

  it('rejestruje konto i od razu loguje użytkownika', async () => {
    const c = await newClient(app);
    const res = await c
      .post('/api/auth/register', { name: '  Anna  ', email: ' Anna@Example.COM ', password: 'Haslo1234!' })
      .expect(201);
    assert.equal(res.body.user.name, 'Anna');
    assert.equal(res.body.user.email, 'anna@example.com', 'e-mail jest normalizowany');
    assert.equal(res.body.user.password_hash, undefined);
    assert.equal(res.body.user.passwordHash, undefined);
    const me = await c.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.email, 'anna@example.com');
  });

  it('przechowuje hasło jako hash bcrypt', async () => {
    await registerUser(app, 'Hash');
    const { rows } = await db.query('SELECT password_hash FROM users');
    assert.match(rows[0].password_hash, /^\$2[aby]\$/);
    assert.ok(!rows[0].password_hash.includes('Haslo1234!'));
  });

  it('odrzuca zduplikowany e-mail (bez względu na wielkość liter) z polskim komunikatem', async () => {
    const a = await newClient(app);
    await a.post('/api/auth/register', { name: 'A', email: 'dup@example.com', password: 'Haslo1234!' }).expect(201);
    const b = await newClient(app);
    const res = await b.post('/api/auth/register', { name: 'B', email: 'DUP@example.com', password: 'Haslo1234!' }).expect(409);
    assert.equal(res.body.error, 'Konto z tym adresem e-mail już istnieje.');
  });

  it('waliduje dane rejestracji i zwraca błędy po polsku', async () => {
    const c = await newClient(app);
    const res = await c.post('/api/auth/register', { name: '', email: 'zly-email', password: 'krotkie' }).expect(400);
    assert.equal(res.body.error, 'Formularz zawiera błędy.');
    assert.match(res.body.fields.name, /wymagane/);
    assert.match(res.body.fields.email, /poprawny adres e-mail/);
    assert.match(res.body.fields.password, /co najmniej 8 znaków/);
  });

  it('loguje poprawnymi danymi i odrzuca błędne hasło ogólnym komunikatem', async () => {
    const u = await registerUser(app, 'Login');
    const c = await newClient(app);
    const bad = await c.post('/api/auth/login', { email: u.email, password: 'zlehaslo!' }).expect(401);
    assert.equal(bad.body.error, 'Nieprawidłowy adres e-mail lub hasło.');
    const none = await c.post('/api/auth/login', { email: 'brak@example.com', password: 'zlehaslo!' }).expect(401);
    assert.equal(none.body.error, bad.body.error, 'brak różnicy między nieistniejącym kontem a złym hasłem');
    const ok = await c.post('/api/auth/login', { email: u.email.toUpperCase(), password: 'Haslo1234!' }).expect(200);
    assert.equal(ok.body.user.id, u.user.id);
  });

  it('zmienia identyfikator sesji po zalogowaniu (ochrona przed session fixation)', async () => {
    const u = await registerUser(app, 'Fix');
    const agent = request.agent(app);
    const r1 = await agent.get('/api/csrf');
    const cookieBefore = r1.headers['set-cookie'][0].split(';')[0];
    const r2 = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', r1.body.csrfToken)
      .send({ email: u.email, password: 'Haslo1234!' })
      .expect(200);
    const cookieAfter = r2.headers['set-cookie'][0].split(';')[0];
    assert.notEqual(cookieBefore, cookieAfter);
    assert.notEqual(r1.body.csrfToken, r2.body.csrfToken);
  });

  it('ustawia bezpieczne flagi ciasteczka sesji', async () => {
    const res = await request(app).get('/api/csrf');
    const cookie = res.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  it('wylogowuje i blokuje dostęp do chronionych endpointów', async () => {
    const u = await registerUser(app, 'Out');
    await u.get('/api/groups').expect(200);
    await u.post('/api/auth/logout', {}).expect(200);
    const res = await u.get('/api/groups').expect(401);
    assert.equal(res.body.error, 'Musisz się zalogować.');
  });

  it('wymaga zalogowania dla chronionych endpointów', async () => {
    for (const url of ['/api/groups', '/api/lists/mine', '/api/notifications', '/api/dashboard', '/api/lists/1']) {
      await request(app).get(url).expect(401);
    }
  });

  it('odrzuca operacje zmieniające dane bez tokenu CSRF', async () => {
    const u = await registerUser(app, 'Csrf');
    const res = await u.agent.post('/api/groups').send({ name: 'Bez tokenu' }).expect(403);
    assert.match(res.body.error, /Odśwież stronę/);
    await u.agent.post('/api/groups').set('X-CSRF-Token', 'x'.repeat(64)).send({ name: 'Zły token' }).expect(403);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM groups');
    assert.equal(rows[0].n, 0);
  });

  it('edytuje profil; zmiana e-maila i hasła wymaga aktualnego hasła', async () => {
    const u = await registerUser(app, 'Prof');
    const r1 = await u.patch('/api/me', { name: 'Nowe Imię' }).expect(200);
    assert.equal(r1.body.user.name, 'Nowe Imię');
    await u.patch('/api/me', { email: 'nowy@example.com' }).expect(400);
    await u.patch('/api/me', { email: 'nowy@example.com', currentPassword: 'zle-haslo' }).expect(400);
    await u.patch('/api/me', { email: 'nowy@example.com', currentPassword: 'Haslo1234!', newPassword: 'NoweHaslo99' }).expect(200);
    const c = await newClient(app);
    await c.post('/api/auth/login', { email: 'nowy@example.com', password: 'NoweHaslo99' }).expect(200);
  });

  it('ogranicza liczbę nieudanych prób logowania', async () => {
    const limited = createApp({ loginMax: 3 });
    const c = await newClient(limited);
    for (let i = 0; i < 3; i += 1) {
      await c.post('/api/auth/login', { email: 'x@example.com', password: 'zlehaslo1' }).expect(401);
    }
    const res = await c.post('/api/auth/login', { email: 'x@example.com', password: 'zlehaslo1' }).expect(429);
    assert.match(res.body.error, /Zbyt wiele prób/);
  });

  it('ustawia nagłówki bezpieczeństwa', async () => {
    const res = await request(app).get('/').expect(200);
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['x-powered-by'], undefined);
  });
});
