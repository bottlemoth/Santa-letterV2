'use strict';

const { ZodError } = require('zod');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const NOT_FOUND_MSG = 'Nie znaleziono zasobu.';

const badRequest = (msg, extra) => new HttpError(400, msg, extra);
const unauthorized = (msg = 'Musisz się zalogować.') => new HttpError(401, msg);
const forbidden = (msg = 'Brak uprawnień do wykonania tej operacji.') => new HttpError(403, msg);
// Jedna, stała odpowiedź 404 dla wszystkiego, do czego użytkownik nie ma dostępu —
// nie zdradzamy, czy zasób istnieje.
const notFound = (msg = NOT_FOUND_MSG) => new HttpError(404, msg);
const conflict = (msg, extra) => new HttpError(409, msg, extra);

function zodToFields(err) {
  const fields = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: NOT_FOUND_MSG });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Formularz zawiera błędy.', fields: zodToFields(err) });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Plik jest zbyt duży.' });
    }
    return res.status(400).json({ error: 'Nieprawidłowe przesłanie pliku.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Nieprawidłowy format danych.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Przesłane dane są zbyt duże.' });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'Wystąpił nieoczekiwany błąd serwera. Spróbuj ponownie.' });
}

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  notFoundHandler,
  errorHandler,
};
