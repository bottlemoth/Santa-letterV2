'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { badRequest } = require('./errors');

// Plik trafia najpierw do pamięci (z twardym limitem rozmiaru), a na dysk zapisujemy
// go dopiero po weryfikacji sygnatury binarnej ("magic bytes").
// Nazwa i typ MIME od klienta są całkowicie ignorowane.
const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 30, fieldSize: 10 * 1024 },
});

/** Przyjmuje opcjonalne pole "image" w formularzu multipart. */
const imageUpload = multerUpload.single('image');

function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

/** Weryfikuje plik bez zapisywania. Zwraca rozszerzenie albo rzuca błąd 400. */
function validateImage(file) {
  if (!file) return null;
  const ext = detectImageType(file.buffer);
  if (!ext) {
    throw badRequest('Nieobsługiwany format zdjęcia. Dozwolone formaty: JPG, PNG, WEBP, GIF.');
  }
  return ext;
}

/** Zapisuje zweryfikowany plik pod losową nazwą. Zwraca nazwę pliku. */
async function saveImage(file) {
  const ext = validateImage(file);
  if (!ext) return null;
  await fs.mkdir(config.uploadDir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(config.uploadDir, filename), file.buffer, { flag: 'wx', mode: 0o644 });
  return filename;
}

const SAFE_NAME = /^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/;

async function removeImage(filename) {
  if (!filename || !SAFE_NAME.test(filename)) return;
  await fs.unlink(path.join(config.uploadDir, filename)).catch(() => {});
}

module.exports = { imageUpload, validateImage, saveImage, removeImage, detectImageType, SAFE_NAME };
