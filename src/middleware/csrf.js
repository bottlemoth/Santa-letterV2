'use strict';

const crypto = require('crypto');
const { forbidden } = require('./errors');

// Wzorzec "synchronizer token": token przechowywany w sesji po stronie serwera,
// klient odsyła go w nagłówku X-CSRF-Token przy każdej operacji zmieniającej dane.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function rotateToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expected = req.session && req.session.csrfToken;
  const provided = req.get('x-csrf-token');
  if (
    typeof expected === 'string' &&
    typeof provided === 'string' &&
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  ) {
    return next();
  }
  return next(forbidden('Sesja wygasła lub żądanie jest nieprawidłowe. Odśwież stronę i spróbuj ponownie.'));
}

module.exports = { csrfProtection, issueToken, rotateToken };
