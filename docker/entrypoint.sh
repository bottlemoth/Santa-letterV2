#!/bin/sh
set -e

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "[entrypoint] Uruchamiam migracje bazy danych..."
  node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m migrations --no-check-order --no-verbose
  echo "[entrypoint] Migracje zakończone."
fi

exec "$@"
