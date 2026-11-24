'use strict';

const express = require('express');
const db = require('../db');
const schemas = require('../validation/schemas');
const { notFound } = require('../middleware/errors');
const { generateUpcoming } = require('../services/notifications');

function serialize(n) {
  return { id: n.id, type: n.type, message: n.message, link: n.link, read: Boolean(n.read_at), createdAt: n.created_at };
}

module.exports = function notificationRoutes() {
  const router = express.Router();

  router.get('/notifications', async (req, res) => {
    await generateUpcoming(req.userId);
    const { rows } = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
      [req.userId],
    );
    const unread = await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [
      req.userId,
    ]);
    res.json({ notifications: rows.map(serialize), unreadCount: unread.rows[0].n });
  });

  router.get('/notifications/unread-count', async (req, res) => {
    await generateUpcoming(req.userId);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [
      req.userId,
    ]);
    res.json({ unreadCount: rows[0].n });
  });

  router.post('/notifications/read-all', async (req, res) => {
    await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.userId]);
    res.json({ ok: true, unreadCount: 0 });
  });

  router.post('/notifications/:id/read', async (req, res) => {
    const id = schemas.parseId(req.params.id);
    const { rows } = await db.query(
      'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.userId],
    );
    if (!rows[0]) throw notFound();
    res.json({ notification: serialize(rows[0]) });
  });

  return router;
};
