'use strict';

const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const schemas = require('../validation/schemas');
const { notFound, forbidden, conflict, badRequest } = require('../middleware/errors');
const { getMembership } = require('../services/access');
const { notify } = require('../services/notifications');

// Bez znaków mylących wizualnie (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function generateInviteCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Wstawia z nowym kodem; ponawia w (mało prawdopodobnym) przypadku kolizji. */
async function withUniqueCode(fn) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fn(generateInviteCode());
    } catch (err) {
      if (err.code !== '23505' || !String(err.constraint || '').includes('invite_code')) throw err;
    }
  }
  throw new Error('Nie udało się wygenerować unikalnego kodu zaproszenia.');
}

function serializeGroup(row, role) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    role,
    memberCount: row.member_count !== undefined ? Number(row.member_count) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Członkostwo albo 404 (nie zdradzamy istnienia grupy). */
async function requireMember(groupId, userId, client) {
  const m = await getMembership(groupId, userId, client);
  if (!m) throw notFound();
  return m;
}

async function requireAdmin(groupId, userId, client) {
  const m = await requireMember(groupId, userId, client);
  if (m.role !== 'admin') throw forbidden('Tę operację może wykonać tylko administrator grupy.');
  return m;
}

async function loadGroupDetails(groupId, viewerId) {
  const g = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
  const members = await db.query(
    `SELECT u.id, u.name, gm.role, gm.joined_at
       FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY (gm.role = 'admin') DESC, u.name`,
    [groupId],
  );
  const me = members.rows.find((m) => m.id === viewerId);
  return {
    ...serializeGroup(g.rows[0], me.role),
    memberCount: members.rows.length,
    inviteCode: g.rows[0].invite_code,
    members: members.rows.map((m) => ({ id: m.id, name: m.name, role: m.role, joinedAt: m.joined_at, isMe: m.id === viewerId })),
  };
}

module.exports = function groupRoutes({ joinLimiter }) {
  const router = express.Router();

  router.get('/groups', async (req, res) => {
    const { rows } = await db.query(
      `SELECT g.*, gm.role,
              (SELECT count(*) FROM group_members x WHERE x.group_id = g.id) AS member_count
         FROM groups g JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.user_id = $1
        ORDER BY g.name`,
      [req.userId],
    );
    res.json({ groups: rows.map((r) => serializeGroup(r, r.role)) });
  });

  router.post('/groups', async (req, res) => {
    const data = schemas.groupCreate.parse(req.body);
    const groupId = await db.tx(async (client) => {
      const g = await withUniqueCode((code) =>
        client.query(
          `INSERT INTO groups (name, description, kind, invite_code, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [data.name, data.description ?? null, data.kind, code, req.userId],
        ),
      );
      const id = g.rows[0].id;
      await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')`, [id, req.userId]);
      return id;
    });
    res.status(201).json({ group: await loadGroupDetails(groupId, req.userId) });
  });

  router.post('/groups/join', joinLimiter, async (req, res) => {
    const { code } = schemas.joinGroup.parse(req.body);
    const result = await db.tx(async (client) => {
      const g = await client.query('SELECT id, name FROM groups WHERE invite_code = $1', [code]);
      if (!g.rows[0]) throw notFound('Nie znaleziono grupy o podanym kodzie. Sprawdź kod i spróbuj ponownie.');
      const group = g.rows[0];
      const ins = await client.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING RETURNING group_id`,
        [group.id, req.userId],
      );
      if (!ins.rows[0]) throw conflict('Już należysz do tej grupy.', { groupId: group.id });
      const me = await client.query('SELECT name FROM users WHERE id = $1', [req.userId]);
      const others = await client.query('SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2', [
        group.id,
        req.userId,
      ]);
      await notify(
        others.rows.map((r) => r.user_id),
        { type: 'group_joined', message: `${me.rows[0].name} dołączył(a) do grupy „${group.name}”.`, link: `/groups/${group.id}` },
        client,
      );
      await notify(
        [req.userId],
        { type: 'group_welcome', message: `Dołączono do grupy „${group.name}”. Miłego obdarowywania!`, link: `/groups/${group.id}` },
        client,
      );
      return group.id;
    });
    res.status(201).json({ group: await loadGroupDetails(result, req.userId) });
  });

  router.get('/groups/:id', async (req, res) => {
    const groupId = schemas.parseId(req.params.id);
    await requireMember(groupId, req.userId);
    res.json({ group: await loadGroupDetails(groupId, req.userId) });
  });

  router.patch('/groups/:id', async (req, res) => {
    const groupId = schemas.parseId(req.params.id);
    await requireAdmin(groupId, req.userId);
    const data = schemas.groupUpdate.parse(req.body);
    await db.query(
      `UPDATE groups SET
          name = COALESCE($2, name),
          description = CASE WHEN $3::boolean THEN $4 ELSE description END,
          kind = COALESCE($5, kind),
          updated_at = now()
        WHERE id = $1`,
      [groupId, data.name ?? null, data.description !== undefined, data.description ?? null, data.kind ?? null],
    );
    res.json({ group: await loadGroupDetails(groupId, req.userId) });
  });

  router.post('/groups/:id/invite-code', async (req, res) => {
    const groupId = schemas.parseId(req.params.id);
    await requireAdmin(groupId, req.userId);
    const code = await withUniqueCode(async (c) => {
      await db.query('UPDATE groups SET invite_code = $2, invite_code_updated_at = now(), updated_at = now() WHERE id = $1', [
        groupId,
        c,
      ]);
      return c;
    });
    res.json({ inviteCode: code });
  });

  router.delete('/groups/:id/members/:userId', async (req, res) => {
    const groupId = schemas.parseId(req.params.id);
    const targetId = schemas.parseId(req.params.userId);
    await requireAdmin(groupId, req.userId);
    if (targetId === req.userId) {
      throw badRequest('Nie możesz usunąć samego siebie. Użyj opcji „Opuść grupę”.');
    }
    await db.tx(async (client) => {
      const del = await client.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id', [
        groupId,
        targetId,
      ]);
      if (!del.rows[0]) throw notFound('Ta osoba nie jest członkiem grupy.');
      const g = await client.query('SELECT name FROM groups WHERE id = $1', [groupId]);
      await notify([targetId], { type: 'group_removed', message: `Usunięto Cię z grupy „${g.rows[0].name}”.` }, client);
    });
    res.json({ group: await loadGroupDetails(groupId, req.userId) });
  });

  router.post('/groups/:id/transfer', async (req, res) => {
    const groupId = schemas.parseId(req.params.id);
    const { userId: targetId } = schemas.transferOwnership.parse(req.body);
    await db.tx(async (client) => {
      // Blokada wiersza grupy serializuje równoległe przekazania własności.
      await client.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId]);
      await requireAdmin(groupId, req.userId, client);
      if (targetId === req.userId) throw badRequest('Już jesteś administratorem tej grupy.');
      const target = await getMembership(groupId, targetId, client);
      if (!target) throw badRequest('Wybrana osoba nie jest członkiem grupy.');
      await client.query(`UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2`, [groupId, req.userId]);
      await client.query(`UPDATE group_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`, [groupId, targetId]);
      const g = await client.query('SELECT name FROM groups WHERE id = $1', [groupId]);
      await notify(
        [targetId],
        { type: 'group_ownership', message: `Zostałeś(-aś) administratorem grupy „${g.rows[0].name}”.`, link: `/groups/${groupId}` },
        client,
      );
    });
    res.json({ group: await loadGroupDetails(groupId, req.userId) });
  });

  router.post('/groups/:id/leave', async (req, res) => {
    const groupId = schemas.parseId(req.params.id);
    const outcome = await db.tx(async (client) => {
      await client.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId]);
      const m = await requireMember(groupId, req.userId, client);
      const count = await client.query('SELECT count(*)::int AS n FROM group_members WHERE group_id = $1', [groupId]);
      if (m.role === 'admin') {
        if (count.rows[0].n > 1) {
          throw conflict('Przed opuszczeniem grupy przekaż jej własność innemu członkowi.');
        }
        await client.query('DELETE FROM groups WHERE id = $1', [groupId]);
        return 'deleted';
      }
      await client.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, req.userId]);
      return 'left';
    });
    res.json({ ok: true, groupDeleted: outcome === 'deleted' });
  });

  router.delete('/groups/:id', async (req, res) => {
    const groupId = schemas.parseId(req.params.id);
    await requireAdmin(groupId, req.userId);
    await db.tx(async (client) => {
      const g = await client.query('SELECT name FROM groups WHERE id = $1', [groupId]);
      const others = await client.query('SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2', [
        groupId,
        req.userId,
      ]);
      await notify(others.rows.map((r) => r.user_id), { type: 'group_deleted', message: `Grupa „${g.rows[0].name}” została usunięta.` }, client);
      await client.query('DELETE FROM groups WHERE id = $1', [groupId]);
    });
    res.status(204).end();
  });

  return router;
};
