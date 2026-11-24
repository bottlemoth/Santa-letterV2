'use strict';

/**
 * Przygotowuje bazę testową: tworzy ją, jeśli nie istnieje, i uruchamia migracje.
 * Używa TEST_DATABASE_URL — nigdy nie dotyka bazy produkcyjnej.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const { Client } = require('pg');
const { execFileSync } = require('child_process');

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Brak TEST_DATABASE_URL — ustaw go w .env lub w środowisku.');
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!/test/i.test(dbName)) {
    throw new Error(`Odmawiam uruchomienia testów na bazie "${dbName}" — nazwa musi zawierać "test".`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rows[0]) {
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`[test] Utworzono bazę ${dbName}.`);
  }
  await client.end();

  execFileSync(
    process.execPath,
    [path.join(__dirname, '..', '..', 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js'), 'up', '-m', 'migrations', '--no-check-order', '--no-verbose', '-d', 'TEST_DATABASE_URL'],
    { stdio: 'inherit', cwd: path.join(__dirname, '..', '..'), env: process.env },
  );
}

main().catch((err) => {
  console.error('[test] Nie udało się przygotować bazy testowej:', err.message);
  process.exit(1);
});
