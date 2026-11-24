'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env.NODE_ENV || 'development';
const isTest = env === 'test';

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Brak wymaganej zmiennej środowiskowej: ${name}`);
  }
  return value;
}

const sessionSecret = required('SESSION_SECRET', isTest ? 'test-session-secret-only-for-tests' : undefined);
if (env === 'production' && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET musi mieć co najmniej 32 znaki w środowisku produkcyjnym.');
}

module.exports = {
  env,
  isTest,
  isProduction: env === 'production',
  port: Number(process.env.PORT) || 3000,
  databaseUrl: isTest ? required('TEST_DATABASE_URL') : required('DATABASE_URL'),
  sessionSecret,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024,
  loginRateLimit: { windowMs: 15 * 60 * 1000, max: isTest ? 1000 : 10 },
  upcomingDays: 14,
  bcryptRounds: isTest ? 4 : 12,
};
