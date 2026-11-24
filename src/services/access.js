'use strict';

const db = require('../db');

/**
 * Centralna kontrola dostępu. Każda decyzja opiera się na ID z sesji
 * (viewerId) i danych z bazy — nigdy na danych przesłanych przez klienta.
 */

/** Czy dwaj użytkownicy należą do co najmniej jednej wspólnej grupy? */
async function sharesGroup(userA, userB, client = db) {
  if (userA === userB) return true;
  const { rows } = await client.query(
    `SELECT 1 FROM group_members a
       JOIN group_members b ON b.group_id = a.group_id
      WHERE a.user_id = $1 AND b.user_id = $2
      LIMIT 1`,
    [userA, userB],
  );
  return rows.length > 0;
}

/** Czy viewer może oglądać listy użytkownika ownerId? */
function canViewUser(viewerId, ownerId, client = db) {
  return sharesGroup(viewerId, ownerId, client);
}

/**
 * Pobiera listę, jeśli viewer ma do niej dostęp (właściciel lub wspólna grupa).
 * Zwraca null w każdym innym przypadku — wywołujący odpowiada wtedy 404.
 * UWAGA: zapytanie celowo nie dotyka tabel reservations / secret_ideas.
 */
async function getVisibleList(viewerId, listId, client = db) {
  const { rows } = await client.query(
    `SELECT l.*, u.name AS owner_name
       FROM gift_lists l
       JOIN users u ON u.id = l.owner_id
      WHERE l.id = $1
        AND (l.owner_id = $2 OR EXISTS (
              SELECT 1 FROM group_members a
                JOIN group_members b ON b.group_id = a.group_id
               WHERE a.user_id = $2 AND b.user_id = l.owner_id))`,
    [listId, viewerId],
  );
  return rows[0] || null;
}

/** Pobiera pozycję razem z jej listą, jeśli viewer ma dostęp. Bez danych o rezerwacjach. */
async function getVisibleItem(viewerId, itemId, client = db) {
  const { rows } = await client.query(
    `SELECT i.*, l.owner_id, l.status AS list_status, l.mode AS list_mode
       FROM gift_items i
       JOIN gift_lists l ON l.id = i.list_id
      WHERE i.id = $1
        AND (l.owner_id = $2 OR EXISTS (
              SELECT 1 FROM group_members a
                JOIN group_members b ON b.group_id = a.group_id
               WHERE a.user_id = $2 AND b.user_id = l.owner_id))`,
    [itemId, viewerId],
  );
  return rows[0] || null;
}

/** Zwraca członkostwo użytkownika w grupie (z rolą) albo null. */
async function getMembership(groupId, userId, client = db) {
  const { rows } = await client.query(
    'SELECT group_id, user_id, role FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  return rows[0] || null;
}

/** ID wszystkich użytkowników dzielących z userId jakąkolwiek grupę (bez niego samego). */
async function coMemberIds(userId, client = db) {
  const { rows } = await client.query(
    `SELECT DISTINCT b.user_id
       FROM group_members a
       JOIN group_members b ON b.group_id = a.group_id
      WHERE a.user_id = $1 AND b.user_id <> $1`,
    [userId],
  );
  return rows.map((r) => r.user_id);
}

module.exports = { sharesGroup, canViewUser, getVisibleList, getVisibleItem, getMembership, coMemberIds };
