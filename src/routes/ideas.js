'use strict';

const express = require('express');
const db = require('../db');
const schemas = require('../validation/schemas');
const { notFound, forbidden, badRequest, conflict } = require('../middleware/errors');
const { getVisibleList } = require('../services/access');
const { imageUpload, validateImage, saveImage, removeImage } = require('../middleware/upload');
const ser = require('../services/serializers');

/**
 * Tajne pomysły na listach w trybie „Niespodzianka”.
 * Właściciel listy jest traktowany tak, jakby pomysły NIE ISTNIAŁY (404) —
 * zarówno przy odczycie, jak i przy próbie modyfikacji.
 */

async function requireGuestList(viewerId, listId) {
  const list = await getVisibleList(viewerId, listId);
  if (!list || list.owner_id === viewerId) throw notFound();
  return list;
}

async function loadIdea(ideaId, viewerId) {
  const { rows } = await db.query(
    `SELECT si.*, u.name AS author_name, l.owner_id
       FROM secret_ideas si
       JOIN gift_lists l ON l.id = si.list_id
       JOIN users u ON u.id = si.author_id
      WHERE si.id = $1`,
    [ideaId],
  );
  const idea = rows[0];
  if (!idea || idea.owner_id === viewerId) throw notFound();
  const visible = await getVisibleList(viewerId, idea.list_id);
  if (!visible) throw notFound();
  if (idea.author_id !== viewerId) throw forbidden('Możesz zmieniać tylko własne pomysły.');
  return idea;
}

module.exports = function ideaRoutes() {
  const router = express.Router();

  router.get('/lists/:id/ideas', async (req, res) => {
    const listId = schemas.parseId(req.params.id);
    await requireGuestList(req.userId, listId);
    const { rows } = await db.query(
      `SELECT si.*, u.name AS author_name FROM secret_ideas si JOIN users u ON u.id = si.author_id
        WHERE si.list_id = $1 ORDER BY si.created_at, si.id`,
      [listId],
    );
    res.json({ ideas: rows.map((r) => ser.idea(r, req.userId)) });
  });

  router.post('/lists/:id/ideas', imageUpload, async (req, res) => {
    const listId = schemas.parseId(req.params.id);
    const list = await requireGuestList(req.userId, listId);
    if (list.mode !== 'surprise') throw badRequest('Tajne pomysły można dodawać tylko do list w trybie „Niespodzianka”.');
    if (list.status !== 'active') throw conflict('Ta lista jest zarchiwizowana.');
    const data = schemas.ideaCreate.parse(req.body || {});
    validateImage(req.file);
    const saved = await saveImage(req.file);
    try {
      const { rows } = await db.query(
        `INSERT INTO secret_ideas (list_id, author_id, name, url, image_path, image_url, private_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [listId, req.userId, data.name, data.url ?? null, saved, saved ? null : data.imageUrl ?? null, data.privateNote ?? null],
      );
      const me = await db.query('SELECT name FROM users WHERE id = $1', [req.userId]);
      res.status(201).json({ idea: ser.idea({ ...rows[0], author_name: me.rows[0].name }, req.userId) });
    } catch (err) {
      await removeImage(saved);
      throw err;
    }
  });

  router.patch('/ideas/:id', imageUpload, async (req, res) => {
    const ideaId = schemas.parseId(req.params.id);
    const current = await loadIdea(ideaId, req.userId);
    const data = schemas.ideaUpdate.parse(req.body || {});
    validateImage(req.file);
    const saved = await saveImage(req.file);
    let imagePath = current.image_path;
    let imageUrl = current.image_url;
    if (data.removeImage) {
      imagePath = null;
      imageUrl = null;
    }
    if (data.imageUrl !== undefined) {
      imageUrl = data.imageUrl;
      if (imageUrl) imagePath = null;
    }
    if (saved) {
      imagePath = saved;
      imageUrl = null;
    }
    const { rows } = await db.query(
      `UPDATE secret_ideas SET
          name = COALESCE($2, name),
          url = CASE WHEN $3::boolean THEN $4 ELSE url END,
          image_path = $5, image_url = $6,
          private_note = CASE WHEN $7::boolean THEN $8 ELSE private_note END,
          updated_at = now()
        WHERE id = $1 AND author_id = $9 RETURNING *`,
      [ideaId, data.name ?? null, data.url !== undefined, data.url ?? null, imagePath, imageUrl, data.privateNote !== undefined, data.privateNote ?? null, req.userId],
    );
    if (current.image_path && current.image_path !== imagePath) await removeImage(current.image_path);
    res.json({ idea: ser.idea({ ...rows[0], author_name: current.author_name }, req.userId) });
  });

  router.delete('/ideas/:id', async (req, res) => {
    const ideaId = schemas.parseId(req.params.id);
    const idea = await loadIdea(ideaId, req.userId);
    await db.query('DELETE FROM secret_ideas WHERE id = $1 AND author_id = $2', [ideaId, req.userId]);
    await removeImage(idea.image_path);
    res.status(204).end();
  });

  return router;
};
