'use strict';

const db = require('../db');
const config = require('../config');

/**
 * Tworzy powiadomienia dla wielu użytkowników.
 *
 * `protectFromUserId` — ID właściciela listy, który NIGDY nie może dostać
 * powiadomienia związanego z rezerwacjami / tajnymi pomysłami na jego listach.
 * Jest odfiltrowywany bezwarunkowo, niezależnie od listy odbiorców.
 */
async function notify(userIds, { type, message, link = null, dedupeKey = null, protectFromUserId = null }, client = db) {
  const recipients = [...new Set(userIds)].filter((id) => id && id !== protectFromUserId);
  if (recipients.length === 0) return;
  await client.query(
    `INSERT INTO notifications (user_id, type, message, link, dedupe_key)
     SELECT unnest($1::bigint[]), $2, $3, $4, $5
     ON CONFLICT DO NOTHING`,
    [recipients, type, message.slice(0, 500), link, dedupeKey],
  );
}

/**
 * Leniwie generuje przypomnienia o zbliżających się okazjach (listy innych
 * członków wspólnych grup z datą w ciągu N dni). Deduplikacja po kluczu.
 * Treść nie zawiera żadnych danych o rezerwacjach.
 */
async function generateUpcoming(userId) {
  await db.query(
    `INSERT INTO notifications (user_id, type, message, link, dedupe_key)
     SELECT $1, 'upcoming_occasion',
            'Zbliża się okazja: „' || l.name || '” (' || u.name || ') — ' || to_char(l.event_date, 'DD.MM.YYYY') || '.',
            '/lists/' || l.id,
            'upcoming:' || l.id || ':' || l.event_date
       FROM gift_lists l
       JOIN users u ON u.id = l.owner_id
      WHERE l.owner_id <> $1
        AND l.status = 'active'
        AND l.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2::int
        AND EXISTS (SELECT 1 FROM group_members a
                      JOIN group_members b ON b.group_id = a.group_id
                     WHERE a.user_id = $1 AND b.user_id = l.owner_id)
     ON CONFLICT DO NOTHING`,
    [userId, config.upcomingDays],
  );
}

module.exports = { notify, generateUpcoming };
