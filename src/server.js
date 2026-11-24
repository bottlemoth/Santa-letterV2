'use strict';

const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[santa-letter] Serwer działa na porcie ${config.port} (${config.env}).`);
});

function shutdown(signal) {
  console.log(`[santa-letter] Otrzymano ${signal}, zamykam...`);
  server.close(() => {
    db.pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
