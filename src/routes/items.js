'use strict';

const express = require('express');
const db = require('../db');
const schemas = require('../validation/schemas');
const { notFound, forbidden, badRequest, conflict } = require('../middleware/errors');
const { getVisibleList, getVisibleItem } = require('../services/access');
const { imageUpload, validateImage, saveImage, removeImage } = require('../middleware/upload');
const { notify } = require('../services/notifications');
const listsSvc = require('../services/lists');
const ser = require('../services/serializers');

/** Rozstrzyga nowy stan zdjęcia (plik ma pierwszeństwo przed URL-em). */
function resolveImage(current, data, savedFile) {
  let imagePath = current ? current.image_path : null;
  let imageUrl = current ? current.image_url : null;
  if (data.removeImage) {
    imagePath = null;
    imageUrl = null;
  }
  if (data.imageUrl !== undefined) {
    imageUrl = data.imageUrl;
    if (imageUrl) imagePath = null;
  }
  if (savedFile) {
    imagePath = savedFile;
    imageUrl = null;
  }
  return { imagePath, imageUrl };
}

// Stałe komunikaty dla właściciela — identyczne niezależnie od stanu rezerwacji.
const OWN_ITEM_RESERVE_MSG = 'Nie możesz zaklepać prezentu z własnej listy.';
const OWN_ITEM_MANAGE_MSG = 'Nie możesz zarządzać rezerwacjami na własnej liście.';

module.exports = function itemRoutes() {
  const router = express.Router();

  // ---------- pozycje (tylko właściciel listy) ----------

  router.post('/lists/:id/items', imageUpload, async (req, res) => {
    const listId = schemas.parseId(req.params.id);
    const list = await getVisibleList(req.userId, listId);
    if (!list) throw notFound();
    if (list.owner_id !== req.userId) throw forbidden('Możesz dodawać prezenty tylko do własnych list.');
    if (list.mode !== 'standard') {
      throw badRequest('Do listy w trybie „Niespodzianka” nie dodaje się konkretnych prezentów.');
    }
    const data = schemas.itemCreate.parse(req.body || {});
    validateImage(req.file);
    const saved = await saveImage(req.file);
    const img = resolveImage(null, data, saved);
    try {
      const { rows } = await db.query(
        `INSERT INTO gift_items (list_id, name, url, image_path, image_url, notes, price, currency, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'PLN'), COALESCE($9, 'medium')::item_priority)
         RETURNING *`,
        [listId, data.name, data.url ?? null, img.imagePath, img.imageUrl, data.notes ?? null, data.price ?? null, data.currency ?? null, data.priority ?? null],
      );
      await db.query('UPDATE gift_lists SET updated_at = now() WHERE id = $1', [listId]);
      res.status(201).json({ item: ser.ownerItem(rows[0]) });
    } catch (err) {
      await removeImage(saved);
      throw err;
    }
  });

  async function requireOwnItem(viewerId, itemId) {
    const item = await getVisibleItem(viewerId, itemId);
    if (!item) throw notFound();
    if (item.owner_id !== viewerId) throw forbidden('Możesz edytować tylko prezenty z własnych list.');
    return item;
  }

  router.patch('/items/:id', imageUpload, async (req, res) => {
    const itemId = schemas.parseId(req.params.id);
    const current = await requireOwnItem(req.userId, itemId);
    const data = schemas.itemUpdate.parse(req.body || {});
    validateImage(req.file);
    const saved = await saveImage(req.file);
    const img = resolveImage(current, data, saved);
    let row;
    try {
      const { rows } = await db.query(
        `UPDATE gift_items SET
            name = COALESCE($2, name),
            url = CASE WHEN $3::boolean THEN $4 ELSE url END,
            image_path = $5,
            image_url = $6,
            notes = CASE WHEN $7::boolean THEN $8 ELSE notes END,
            price = CASE WHEN $9::boolean THEN $10::numeric ELSE price END,
            currency = COALESCE($11, currency),
            priority = COALESCE($12::item_priority, priority),
            updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          itemId,
          data.name ?? null,
          data.url !== undefined,
          data.url ?? null,
          img.imagePath,
          img.imageUrl,
          data.notes !== undefined,
          data.notes ?? null,
          data.price !== undefined,
          data.price ?? null,
          data.currency ?? null,
          data.priority ?? null,
        ],
      );
      row = rows[0];
    } catch (err) {
      await removeImage(saved);
      throw err;
    }
    if (current.image_path && current.image_path !== img.imagePath) await removeImage(current.image_path);
    // Odpowiedź wyłącznie z danymi produktu — bez rezerwacji.
    res.json({ item: ser.ownerItem(row) });
  });

  router.delete('/items/:id', async (req, res) => {
    const itemId = schemas.parseId(req.params.id);
    const item = await requireOwnItem(req.userId, itemId);
    await db.tx(async (client) => {
      // Informujemy rezerwującego (nigdy właściciela). Odpowiedź dla właściciela
      // jest identyczna (204) bez względu na to, czy pozycja była zaklepana.
      const r = await client.query('SELECT reserver_id FROM reservations WHERE item_id = $1', [itemId]);
      if (r.rows[0]) {
        await notify(
          [r.rows[0].reserver_id],
          {
            type: 'reserved_item_removed',
            message: `Prezent „${item.name}”, który zaklepałeś(-aś), został usunięty z listy.`,
            protectFromUserId: item.owner_id,
          },
          client,
        );
      }
      await client.query('DELETE FROM gift_items WHERE id = $1', [itemId]);
      await client.query('UPDATE gift_lists SET updated_at = now() WHERE id = $1', [item.list_id]);
    });
    await removeImage(item.image_path);
    res.status(204).end();
  });

  // ---------- rezerwacje (tylko goście) ----------

  router.post('/items/:id/reservation', async (req, res) => {
    const itemId = schemas.parseId(req.params.id);
    const item = await getVisibleItem(req.userId, itemId);
    if (!item) throw notFound();
    // Sprawdzenie właściciela PRZED jakimkolwiek odczytem stanu rezerwacji.
    if (item.owner_id === req.userId) throw forbidden(OWN_ITEM_RESERVE_MSG);
    if (item.list_status !== 'active') throw conflict('Ta lista jest zarchiwizowana — nie można zaklepywać prezentów.');

    // Atomowość: ograniczenie UNIQUE(item_id) w bazie. Przy dwóch równoczesnych
    // żądaniach dokładnie jedno INSERT się powiedzie, drugie zwróci 0 wierszy.
    const ins = await db.query(
      `INSERT INTO reservations (item_id, reserver_id) VALUES ($1, $2)
       ON CONFLICT (item_id) DO NOTHING RETURNING id`,
      [itemId, req.userId],
    );
    if (!ins.rows[0]) {
      const item2 = await listsSvc.guestItem(itemId, req.userId);
      throw conflict('Ten prezent został już zaklepany przez inną osobę.', { item: item2 });
    }
    res.status(201).json({ item: await listsSvc.guestItem(itemId, req.userId) });
  });

  router.delete('/items/:id/reservation', async (req, res) => {
    const itemId = schemas.parseId(req.params.id);
    const item = await getVisibleItem(req.userId, itemId);
    if (!item) throw notFound();
    if (item.owner_id === req.userId) throw forbidden(OWN_ITEM_MANAGE_MSG);

    const del = await db.query('DELETE FROM reservations WHERE item_id = $1 AND reserver_id = $2 RETURNING id', [
      itemId,
      req.userId,
    ]);
    if (!del.rows[0]) {
      const exists = await db.query('SELECT 1 FROM reservations WHERE item_id = $1', [itemId]);
      if (exists.rows[0]) throw forbidden('Możesz anulować tylko własną rezerwację.');
      throw notFound('Ten prezent nie jest zaklepany.');
    }
    res.json({ item: await listsSvc.guestItem(itemId, req.userId) });
  });

  return router;
};
