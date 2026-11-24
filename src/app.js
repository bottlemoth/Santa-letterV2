'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./db');
const { csrfProtection } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const listRoutes = require('./routes/lists');
const itemRoutes = require('./routes/items');
const ideaRoutes = require('./routes/ideas');
const notificationRoutes = require('./routes/notifications');

/**
 * Fabryka aplikacji — pozwala testom tworzyć instancję z innymi limitami.
 * @param {{ loginMax?: number }} [opts]
 */
function createApp(opts = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // ---------- nagłówki bezpieczeństwa ----------
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'https:', 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      // HSTS tylko gdy aplikacja faktycznie działa za HTTPS.
      strictTransportSecurity: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ---------- healthcheck (bez sesji) ----------
  app.get('/healthz', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'error', db: 'unavailable' });
    }
  });

  // ---------- pliki statyczne frontendu ----------
  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      index: 'index.html',
      maxAge: config.isProduction ? '1h' : 0,
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // ---------- sesje po stronie serwera (PostgreSQL) ----------
  app.use(
    session({
      name: 'sl.sid',
      store: new PgSession({
        pool: db.pool,
        tableName: 'session',
        createTableIfMissing: false,
        pruneSessionInterval: config.isTest ? false : 60 * 15,
      }),
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      },
    }),
  );

  // ---------- przesłane zdjęcia (tylko dla zalogowanych, nazwy losowe UUID) ----------
  app.use(
    '/uploads',
    requireAuth,
    express.static(config.uploadDir, {
      index: false,
      dotfiles: 'deny',
      fallthrough: false,
      setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'private, max-age=86400');
      },
    }),
  );

  // ---------- API ----------
  const loginLimiter = rateLimit({
    windowMs: config.loginRateLimit.windowMs,
    limit: opts.loginMax ?? config.loginRateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Zbyt wiele prób logowania. Spróbuj ponownie za kilkanaście minut.' },
  });
  const joinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.isTest ? 1000 : 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Zbyt wiele prób dołączenia. Spróbuj ponownie później.' },
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(csrfProtection);
  api.use(authRoutes({ loginLimiter }));
  api.use(requireAuth);
  api.use(groupRoutes({ joinLimiter }));
  api.use(listRoutes());
  api.use(itemRoutes());
  api.use(ideaRoutes());
  api.use(notificationRoutes());
  api.use(notFoundHandler);
  app.use('/api', api);

  app.use((req, res, next) => {
    // Nieznane ścieżki poza /api — SPA korzysta z routingu w hashu, więc 404.
    if (req.method === 'GET' && req.accepts('html')) {
      return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }
    return next();
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
