// G-07: ответ функции — один на все функции.
// Тело всегда JSON, код ответа — как раньше. Ошибки делаются через errReply/slowDown: они добавляют
// tapyor_error (G-06), не меняя поле error, чтобы старые сборки Тапёра работали как раньше.
'use strict';
const { errBody } = require('./errors');

const JSON_UTF8 = 'application/json; charset=utf-8';

// statusCode, тело-объект, необязательные заголовки
function reply(statusCode, body, headers) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': JSON_UTF8 }, headers || {}),
    body: JSON.stringify(body)
  };
}

// Своя ошибка: error — как раньше, tapyor_error — код для нового Тапёра
function errReply(statusCode, error, code, extra) {
  return reply(statusCode, errBody(error, code, extra));
}

// 429 с Retry-After: сколько секунд ждать. Код по умолчанию — rate_limited (лимит частоты),
// у автоотчётов бывает daily_limit (кончился суточный запас новых задач).
function slowDown(sec, code) {
  const c = code || 'rate_limited';
  return {
    statusCode: 429,
    headers: { 'Content-Type': JSON_UTF8, 'Retry-After': String(sec) },
    body: JSON.stringify(errBody('slow down', c, { retry_after: sec }))
  };
}

module.exports = { reply, errReply, slowDown, JSON_UTF8 };
