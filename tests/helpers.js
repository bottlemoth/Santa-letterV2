'use strict';

const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(os.tmpdir(), 'santa-letter-test-uploads');

const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db');

async function resetDb() {
  await db.query('TRUNCATE users, groups, notifications, "session" RESTART IDENTITY CASCADE');
}

/** Klient HTTP z ciasteczkami sesji i automatycznym nagłówkiem CSRF. */
async function newClient(app) {
  const agent = request.agent(app);
  const res = await agent.get('/api/csrf').expect(200);
  const c = {
    agent,
    token: res.body.csrfToken,
    user: null,
    get: (url) => agent.get(url),
    post: (url, body) => agent.post(url).set('X-CSRF-Token', c.token).send(body),
    patch: (url, body) => agent.patch(url).set('X-CSRF-Token', c.token).send(body),
    put: (url, body) => agent.put(url).set('X-CSRF-Token', c.token).send(body),
    del: (url) => agent.delete(url).set('X-CSRF-Token', c.token),
    /** multipart/form-data */
    form: (method, url) => agent[method](url).set('X-CSRF-Token', c.token),
  };
  return c;
}

let counter = 0;
async function registerUser(app, name = 'Użytkownik') {
  counter += 1;
  const c = await newClient(app);
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}${counter}@example.com`;
  const res = await c.post('/api/auth/register', { name, email, password: 'Haslo1234!' }).expect(201);
  c.token = res.body.csrfToken;
  c.user = res.body.user;
  c.email = email;
  return c;
}

/** Tworzy grupę należącą do `admin` i dołącza do niej pozostałych klientów. */
async function makeGroup(admin, members = [], name = 'Rodzina') {
  const g = await admin.post('/api/groups', { name, kind: 'family' }).expect(201);
  for (const m of members) {
    await m.post('/api/groups/join', { code: g.body.group.inviteCode }).expect(201);
  }
  return g.body.group;
}

async function makeList(owner, overrides = {}) {
  const res = await owner.post('/api/lists', { name: 'Święta 2026', occasion: 'christmas', ...overrides }).expect(201);
  return res.body.list;
}

async function addItem(owner, listId, overrides = {}) {
  const res = await owner.post(`/api/lists/${listId}/items`, { name: 'Książka', priority: 'high', ...overrides }).expect(201);
  return res.body.item;
}

/** Rekurencyjnie zbiera wszystkie klucze obiektu JSON. */
function allKeys(obj, acc = new Set()) {
  if (Array.isArray(obj)) obj.forEach((v) => allKeys(v, acc));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

// Minimalne poprawne obrazy do testów uploadu.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

module.exports = { createApp, db, resetDb, newClient, registerUser, makeGroup, makeList, addItem, allKeys, PNG_1PX };
