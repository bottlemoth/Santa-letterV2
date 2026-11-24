'use strict';

const db = require('../db');
const ser = require('./serializers');

/**
 * Budowa odpowiedzi dla listy. Dwie ROZŁĄCZNE ścieżki zapytań:
 *  - właściciel: zapytania WYŁĄCZNIE do gift_items / surprise_profiles,
 *    bez JOIN-ów do reservations ani secret_ideas,
 *  - gość: zapytania z danymi o rezerwacjach i pomysłach.
 */

const ITEM_ORDER = 'ORDER BY i.priority DESC, i.created_at, i.id';

async function ownerItems(listId) {
  const { rows } = await db.query(`SELECT i.* FROM gift_items i WHERE i.list_id = $1 ${ITEM_ORDER}`, [listId]);
  return rows;
}

async function guestItems(listId) {
  const { rows } = await db.query(
    `SELECT i.*, r.id AS reservation_id, r.reserver_id, r.created_at AS reserved_at, ru.name AS reserver_name
       FROM gift_items i
       LEFT JOIN reservations r ON r.item_id = i.id
       LEFT JOIN users ru ON ru.id = r.reserver_id
      WHERE i.list_id = $1 ${ITEM_ORDER}`,
    [listId],
  );
  return rows;
}

async function guestItem(itemId, viewerId) {
  const { rows } = await db.query(
    `SELECT i.*, r.id AS reservation_id, r.reserver_id, r.created_at AS reserved_at, ru.name AS reserver_name
       FROM gift_items i
       LEFT JOIN reservations r ON r.item_id = i.id
       LEFT JOIN users ru ON ru.id = r.reserver_id
      WHERE i.id = $1`,
    [itemId],
  );
  return ser.guestItem(rows[0], viewerId);
}

async function surpriseProfile(listId) {
  const { rows } = await db.query('SELECT * FROM surprise_profiles WHERE list_id = $1', [listId]);
  return rows[0] || null;
}

async function ideas(listId) {
  const { rows } = await db.query(
    `SELECT si.*, u.name AS author_name
       FROM secret_ideas si JOIN users u ON u.id = si.author_id
      WHERE si.list_id = $1
      ORDER BY si.created_at, si.id`,
    [listId],
  );
  return rows;
}

/** `list` musi pochodzić z access.getVisibleList (z owner_name). */
async function buildListResponse(list, viewerId) {
  const sp = list.mode === 'surprise' ? await surpriseProfile(list.id) : null;
  if (list.owner_id === viewerId) {
    const items = list.mode === 'standard' ? await ownerItems(list.id) : [];
    return ser.ownerList(list, items, sp);
  }
  const items = list.mode === 'standard' ? await guestItems(list.id) : [];
  const ideaRows = list.mode === 'surprise' ? await ideas(list.id) : [];
  return ser.guestList(list, items, sp, ideaRows, viewerId);
}

/** Podsumowania list danego właściciela (licznik tylko z gift_items). */
async function listSummariesForOwner(ownerId) {
  const { rows } = await db.query(
    `SELECT l.*, u.name AS owner_name,
            (SELECT count(*) FROM gift_items i WHERE i.list_id = l.id) AS item_count
       FROM gift_lists l JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id = $1
      ORDER BY (l.status = 'active') DESC, l.event_date NULLS LAST, l.created_at DESC`,
    [ownerId],
  );
  return rows.map(ser.listSummary);
}

module.exports = { buildListResponse, guestItem, listSummariesForOwner, ownerItems };
