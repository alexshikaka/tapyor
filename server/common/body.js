// G-07: разбор тела запроса — один на все функции.
// Шлюз Яндекса может прислать тело в base64 (isBase64Encoded), поэтому сначала раскодируем.
// Предел размера у функций разный (у лицензий — 96 КБ: 1000 хэшей ≈ 66 КБ), поэтому он параметр.
'use strict';

// Возвращает { value } при успехе или { code } с кодом ошибки: too_big | bad_request
function readBody(event, maxBytes) {
  let raw = (event && event.body) || '';
  if (event && event.isBase64Encoded) raw = Buffer.from(String(raw), 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { code: 'too_big' };
  let value;
  try { value = JSON.parse(raw || '{}'); } catch (e) { return { code: 'bad_request' }; }
  if (!value || typeof value !== 'object') return { code: 'bad_request' };
  return { value };
}

module.exports = { readBody };
