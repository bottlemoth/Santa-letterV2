'use strict';

/**
 * JEDYNE miejsce budowania odpowiedzi JSON dla list, pozycji i pomysłów.
 *
 * Zasada ochrony niespodzianki:
 *  - Widok właściciela (`ownerItem`, `ownerList`) jest budowany z jawnej listy
 *    dozwolonych pól (allowlist). Nie zawiera klucza `reservation` ani `ideas`
 *    w ogóle — kształt odpowiedzi jest identyczny bez względu na to, czy pozycja
 *    jest zaklepana.
 *  - Widok gościa (`guestItem`, `guestList`) dodaje dane o rezerwacji i pomysłach.
 *  - Nigdy nie serializujemy całych wierszy z bazy (`...row`).
 */

function imageSrc(row) {
  if (row.image_path) return `/uploads/${row.image_path}`;
  return row.image_url || null;
}

function baseItem(row) {
  return {
    id: row.id,
    listId: row.list_id,
    name: row.name,
    url: row.url,
    image: imageSrc(row),
    imageUrl: row.image_url,
    hasUploadedImage: Boolean(row.image_path),
    notes: row.notes,
    price: row.price,
    currency: row.currency,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Pozycja w oczach właściciela listy — wyłącznie dane produktu. */
function ownerItem(row) {
  return baseItem(row);
}

/** Pozycja w oczach innego członka grupy — z informacją o rezerwacji. */
function guestItem(row, viewerId) {
  const item = baseItem(row);
  item.reservation = row.reservation_id
    ? {
        reservedBy: { id: row.reserver_id, name: row.reserver_name },
        isMine: row.reserver_id === viewerId,
        createdAt: row.reserved_at,
      }
    : null;
  return item;
}

function surprise(row) {
  if (!row) {
    return {
      interests: null, categories: null, preferences: null, sizes: null,
      budgetMin: null, budgetMax: null, currency: 'PLN', dislikes: null, notes: null,
    };
  }
  return {
    interests: row.interests,
    categories: row.categories,
    preferences: row.preferences,
    sizes: row.sizes,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    currency: row.currency,
    dislikes: row.dislikes,
    notes: row.notes,
  };
}

function baseList(row) {
  return {
    id: row.id,
    owner: { id: row.owner_id, name: row.owner_name },
    name: row.name,
    occasion: row.occasion,
    occasionLabel: row.occasion_label,
    description: row.description,
    eventDate: row.event_date,
    status: row.status,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownerList(row, itemRows, surpriseRow) {
  const list = baseList(row);
  list.isOwner = true;
  list.items = list.mode === 'standard' ? itemRows.map(ownerItem) : [];
  list.surprise = list.mode === 'surprise' ? surprise(surpriseRow) : null;
  return list;
}

function guestList(row, itemRows, surpriseRow, ideaRows, viewerId) {
  const list = baseList(row);
  list.isOwner = false;
  list.items = list.mode === 'standard' ? itemRows.map((r) => guestItem(r, viewerId)) : [];
  list.surprise = list.mode === 'surprise' ? surprise(surpriseRow) : null;
  list.ideas = list.mode === 'surprise' ? ideaRows.map((r) => idea(r, viewerId)) : [];
  return list;
}

/** Podsumowanie listy (np. na dashboardzie). Licznik dotyczy tylko pozycji. */
function listSummary(row) {
  return {
    id: row.id,
    owner: { id: row.owner_id, name: row.owner_name },
    name: row.name,
    occasion: row.occasion,
    occasionLabel: row.occasion_label,
    eventDate: row.event_date,
    status: row.status,
    mode: row.mode,
    itemCount: Number(row.item_count || 0),
    updatedAt: row.updated_at,
  };
}

/** Tajny pomysł — nigdy nie trafia do właściciela listy. Prywatna uwaga tylko dla autora. */
function idea(row, viewerId) {
  const isMine = row.author_id === viewerId;
  return {
    id: row.id,
    listId: row.list_id,
    name: row.name,
    url: row.url,
    image: imageSrc(row),
    imageUrl: row.image_url,
    hasUploadedImage: Boolean(row.image_path),
    privateNote: isMine ? row.private_note : null,
    author: { id: row.author_id, name: row.author_name },
    isMine,
    createdAt: row.created_at,
  };
}

function user(row) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

module.exports = { ownerItem, guestItem, ownerList, guestList, listSummary, idea, user, surprise };
