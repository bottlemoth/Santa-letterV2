'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const schemas = require('../validation/schemas');
const { conflict, unauthorized, badRequest } = require('../middleware/errors');
const { requireAuth } = require('../middleware/auth');
const { issueToken, rotateToken } = require('../middleware/csrf');
const ser = require('../services/serializers');

const config = require('../config');

const BCRYPT_ROUNDS = config.bcryptRounds;
// Hash używany przy nieistniejącym koncie, aby czas odpowiedzi był podobny.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

/** Ochrona przed session fixation: nowa sesja i nowy token CSRF po zalogowaniu. */
async function startSession(req, userId) {
  await regenerate(req);
  req.session.userId = userId;
  return rotateToken(req);
}

module.exports = function authRoutes({ loginLimiter }) {
  const router = express.Router();

  router.get('/csrf', (req, res) => {
    res.json({ csrfToken: issueToken(req) });
  });

  router.post('/auth/register', loginLimiter, async (req, res) => {
    const data = schemas.register.parse(req.body);
    const hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    let user;
    try {
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
         RETURNING id, name, email, created_at`,
        [data.name, data.email, hash],
      );
      user = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw conflict('Konto z tym adresem e-mail już istnieje.', { fields: { email: 'Ten adres e-mail jest już zajęty.' } });
      }
      throw err;
    }
    const csrfToken = await startSession(req, user.id);
    res.status(201).json({ user: ser.user(user), csrfToken });
  });

  router.post('/auth/login', loginLimiter, async (req, res) => {
    const data = schemas.login.parse(req.body);
    const { rows } = await db.query(
      'SELECT id, name, email, password_hash, created_at FROM users WHERE email = $1',
      [data.email],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(data.password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Nieprawidłowy adres e-mail lub hasło.');
    const csrfToken = await startSession(req, user.id);
    res.json({ user: ser.user(user), csrfToken });
  });

  router.post('/auth/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('sl.sid', { path: '/' });
      return res.json({ ok: true });
    });
  });

  router.get('/auth/me', async (req, res) => {
    if (!req.session.userId) return res.json({ user: null });
    const { rows } = await db.query('SELECT id, name, email, created_at FROM users WHERE id = $1', [
      req.session.userId,
    ]);
    if (!rows[0]) return res.json({ user: null });
    return res.json({ user: ser.user(rows[0]) });
  });

  router.patch('/me', requireAuth, async (req, res) => {
    const data = schemas.profileUpdate.parse(req.body);
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const current = rows[0];
    if (!current) throw unauthorized();

    const emailChanged = data.email !== undefined && data.email !== current.email;
    const sensitive = emailChanged || data.newPassword !== undefined;
    if (sensitive) {
      if (!data.currentPassword) {
        throw badRequest('Podaj aktualne hasło, aby zmienić e-mail lub hasło.', {
          fields: { currentPassword: 'Aktualne hasło jest wymagane.' },
        });
      }
      const ok = await bcrypt.compare(data.currentPassword, current.password_hash);
      if (!ok) {
        throw badRequest('Aktualne hasło jest nieprawidłowe.', {
          fields: { currentPassword: 'Aktualne hasło jest nieprawidłowe.' },
        });
      }
    }

    const hash = data.newPassword ? await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS) : current.password_hash;
    try {
      const upd = await db.query(
        `UPDATE users SET name = $2, email = $3, password_hash = $4, updated_at = now()
          WHERE id = $1 RETURNING id, name, email, created_at`,
        [req.userId, data.name ?? current.name, data.email ?? current.email, hash],
      );
      res.json({ user: ser.user(upd.rows[0]) });
    } catch (err) {
      if (err.code === '23505') {
        throw conflict('Konto z tym adresem e-mail już istnieje.', { fields: { email: 'Ten adres e-mail jest już zajęty.' } });
      }
      throw err;
    }
  });

  return router;
};
