'use strict';

const express = require('express');
const db = require('../db');
const schemas = require('../validation/schemas');
const { notFound, forbidden, badRequest } = require('../middleware/errors');
const { getVisibleList, canViewUser, coMemberIds } = require('../services/access');
const { notify } = require('../services/notifications');
const { removeImage } = require('../middleware/upload');
const listsSvc = require('../services/lists');
const ser = require('../services/serializers');

const OCCASION_PL = { christmas: 'Boże Narodzenie', birthday: 'Urodziny', anniversary: 'Rocznica', other: 'Okazja' };

/** Lista widoczna i należąca do viewera — inaczej 404 (niewidoczna) lub 403 (cudza). */
async function requireOwnList(viewerId, listId) {
  const list = await getVisibleList(viewerId, listId);
  if (!list) throw notFound();
  if (list.owner_id !== viewerId) throw forbidden('Możesz edytować tylko własne listy.');
  return list;
}

async function upsertSurprise(client, listId, data) {
  await client.query(
    `INSERT INTO surprise_profiles
       (list_id, interests, categories, preferences, sizes, budget_min, budget_max, currency, dislikes, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'PLN'), $9, $10, now())
     ON CONFLICT (list_id) DO UPDATE SET
       interests = EXCLUDED.interests, categories = EXCLUDED.categories,
       preferences = EXCLUDED.preferences, sizes = EXCLUDED.sizes,
       budget_min = EXCLUDED.budget_min, budget_max = EXCLUDED.budget_max,
       currency = EXCLUDED.currency, dislikes = EXCLUDED.dislikes,
       notes = EXCLUDED.notes, updated_at = now()`,
    [
      listId,
      data.interests ?? null,
      data.categories ?? null,
      data.preferences ?? null,
      data.sizes ?? null,
      data.budgetMin ?? null,
      data.budgetMax ?? null,
      data.currency ?? null,
      data.dislikes ?? null,
      data.notes ?? null,
    ],
  );
}

module.exports = function listRoutes() {
  const router = express.Router();

  router.get('/lists/mine', async (req, res) => {
    res.json({ lists: await listsSvc.listSummariesForOwner(req.userId) });
  });

  router.post('/lists', async (req, res) => {
    const data = schemas.listCreate.parse(req.body);
    const surpriseData = data.mode === 'surprise' ? schemas.surpriseProfile.parse(req.body.surprise || {}) : null;
    const listId = await db.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO gift_lists (owner_id, name, occasion, occasion_label, description, event_date, status, mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          req.userId,
          data.name,
          data.occasion,
          data.occasionLabel ?? null,
          data.description ?? null,
          data.eventDate ?? null,
          data.status,
          data.mode,
        ],
      );
      const id = rows[0].id;
      if (surpriseData) await upsertSurprise(client, id, surpriseData);
      if (data.status === 'active') {
        const me = await client.query('SELECT name FROM users WHERE id = $1', [req.userId]);
        const label = data.occasion === 'other' && data.occasionLabel ? data.occasionLabel : OCCASION_PL[data.occasion];
        await notify(
          await coMemberIds(req.userId, client),
          {
            type: 'list_published',
            message: `${me.rows[0].name} opublikował(a) nową listę „${data.name}” (${label}).`,
            link: `/lists/${id}`,
          },
          client,
        );
      }
      return id;
    });
    const list = await getVisibleList(req.userId, listId);
    res.status(201).json({ list: await listsSvc.buildListResponse(list, req.userId) });
  });

  router.get('/lists/:id', async (req, res) => {
    const listId = schemas.parseId(req.params.id);
    const list = await getVisibleList(req.userId, listId);
    if (!list) throw notFound();
    res.json({ list: await listsSvc.buildListResponse(list, req.userId) });
  });

  router.patch('/lists/:id', async (req, res) => {
    const listId = schemas.parseId(req.params.id);
    await requireOwnList(req.userId, listId);
    if (req.body && req.body.mode !== undefined) {
      throw badRequest('Trybu listy nie można zmienić po jej utworzeniu.');
    }
    const d = schemas.listUpdate.parse(req.body);
    await db.query(
      `UPDATE gift_lists SET
          name = COALESCE($2, name),
          occasion = COALESCE($3, occasion),
          occasion_label = CASE WHEN $4::boolean THEN $5 ELSE occasion_label END,
          description = CASE WHEN $6::boolean THEN $7 ELSE description END,
          event_date = CASE WHEN $8::boolean THEN $9::date ELSE event_date END,
          status = COALESCE($10, status),
          updated_at = now()
        WHERE id = $1 AND owner_id = $11`,
      [
        listId,
        d.name ?? null,
        d.occasion ?? null,
        d.occasionLabel !== undefined,
        d.occasionLabel ?? null,
        d.description !== undefined,
        d.description ?? null,
        d.eventDate !== undefined,
        d.eventDate ?? null,
        d.status ?? null,
        req.userId,
      ],
    );
    const list = await getVisibleList(req.userId, listId);
    // Odpowiedź budowana ścieżką właściciela — bez danych o rezerwacjach.
    res.json({ list: await listsSvc.buildListResponse(list, req.userId) });
  });

  router.put('/lists/:id/surprise', async (req, res) => {
    const listId = schemas.parseId(req.params.id);
    const list = await requireOwnList(req.userId, listId);
    if (list.mode !== 'surprise') throw badRequest('Ta lista nie jest w trybie „Niespodzianka”.');
    const data = schemas.surpriseProfile.parse(req.body);
    await db.tx(async (client) => {
      await upsertSurprise(client, listId, data);
      await client.query('UPDATE gift_lists SET updated_at = now() WHERE id = $1', [listId]);
    });
    const fresh = await getVisibleList(req.userId, listId);
    res.json({ list: await listsSvc.buildListResponse(fresh, req.userId) });
  });

  router.delete('/lists/:id', async (req, res) => {
    const listId = schemas.parseId(req.params.id);
    const list = await requireOwnList(req.userId, listId);
    const files = await db.tx(async (client) => {
      // Osoby, które zaklepały prezenty lub dodały pomysły, dostają informację —
      // właściciel nigdy (protectFromUserId), a odpowiedź jest zawsze taka sama (204).
      const affected = await client.query(
        `SELECT r.reserver_id AS uid FROM reservations r JOIN gift_items i ON i.id = r.item_id WHERE i.list_id = $1
         UNION SELECT author_id FROM secret_ideas WHERE list_id = $1`,
        [listId],
      );
      await notify(
        affected.rows.map((r) => r.uid),
        { type: 'list_deleted', message: `Lista „${list.name}” (${list.owner_name}) została usunięta.`, protectFromUserId: list.owner_id },
        client,
      );
      const imgs = await client.query(
        `SELECT image_path FROM gift_items WHERE list_id = $1 AND image_path IS NOT NULL
         UNION ALL SELECT image_path FROM secret_ideas WHERE list_id = $1 AND image_path IS NOT NULL`,
        [listId],
      );
      await client.query('DELETE FROM gift_lists WHERE id = $1 AND owner_id = $2', [listId, req.userId]);
      return imgs.rows.map((r) => r.image_path);
    });
    await Promise.all(files.map(removeImage));
    res.status(204).end();
  });

  router.get('/users/:id/lists', async (req, res) => {
    const ownerId = schemas.parseId(req.params.id);
    if (!(await canViewUser(req.userId, ownerId))) throw notFound();
    const u = await db.query('SELECT id, name FROM users WHERE id = $1', [ownerId]);
    if (!u.rows[0]) throw notFound();
    res.json({ user: u.rows[0], lists: await listsSvc.listSummariesForOwner(ownerId) });
  });

  router.get('/dashboard', async (req, res) => {
    const myLists = await listsSvc.listSummariesForOwner(req.userId);
    const friends = await db.query(
      `SELECT l.*, u.name AS owner_name,
              (SELECT count(*) FROM gift_items i WHERE i.list_id = l.id) AS item_count
         FROM gift_lists l JOIN users u ON u.id = l.owner_id
        WHERE l.owner_id <> $1 AND l.status = 'active'
          AND EXISTS (SELECT 1 FROM group_members a JOIN group_members b ON b.group_id = a.group_id
                       WHERE a.user_id = $1 AND b.user_id = l.owner_id)
        ORDER BY l.event_date NULLS LAST, l.updated_at DESC
        LIMIT 12`,
      [req.userId],
    );
    // Prezenty zaklepane PRZEZE MNIE (dane własne użytkownika — brak wycieku).
    const mine = await db.query(
      `SELECT i.id, i.name, l.id AS list_id, l.name AS list_name, u.id AS owner_id, u.name AS owner_name, r.created_at
         FROM reservations r
         JOIN gift_items i ON i.id = r.item_id
         JOIN gift_lists l ON l.id = i.list_id
         JOIN users u ON u.id = l.owner_id
        WHERE r.reserver_id = $1
        ORDER BY r.created_at DESC`,
      [req.userId],
    );
    const ideas = await db.query(
      `SELECT si.id, si.name, l.id AS list_id, l.name AS list_name, u.id AS owner_id, u.name AS owner_name, si.created_at
         FROM secret_ideas si
         JOIN gift_lists l ON l.id = si.list_id
         JOIN users u ON u.id = l.owner_id
        WHERE si.author_id = $1
        ORDER BY si.created_at DESC`,
      [req.userId],
    );
    const groups = await db.query('SELECT count(*)::int AS n FROM group_members WHERE user_id = $1', [req.userId]);
    const toClaim = (r, kind) => ({
      kind,
      id: r.id,
      name: r.name,
      list: { id: r.list_id, name: r.list_name },
      owner: { id: r.owner_id, name: r.owner_name },
      createdAt: r.created_at,
    });
    res.json({
      myLists,
      friendsLists: friends.rows.map(ser.listSummary),
      myClaims: [...mine.rows.map((r) => toClaim(r, 'reservation')), ...ideas.rows.map((r) => toClaim(r, 'idea'))],
      groupCount: groups.rows[0].n,
    });
  });

  return router;
};
