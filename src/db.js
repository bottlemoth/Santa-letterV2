'use strict';

const { Pool, types } = require('pg');
const config = require('./config');

// DATE zwracamy jako 'YYYY-MM-DD' (bez przesunięć strefy czasowej),
// NUMERIC jako string (bez utraty precyzji), BIGINT jako number (ID < 2^53).
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] Nieoczekiwany błąd puli połączeń:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

/** Wykonuje funkcję w transakcji; przekazuje klienta. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
