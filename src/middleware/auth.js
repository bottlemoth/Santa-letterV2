'use strict';

const { unauthorized } = require('./errors');

/**
 * Wymaga zalogowania. Tożsamość użytkownika pochodzi WYŁĄCZNIE z sesji
 * po stronie serwera — nigdy z identyfikatorów przesłanych przez klienta.
 */
function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) return next(unauthorized());
  req.userId = Number(userId);
  return next();
}

module.exports = { requireAuth };
