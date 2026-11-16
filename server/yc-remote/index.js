'use strict';
// Обработчик Yandex Cloud Functions для пульта с телефона (Node.js 22). Логика — core.js, база — store-ydb.js.
// Протокол — docs/REMOTE.md. Функция не знает ключа сессии и видит только зашифрованные куски.
//
// Переменные окружения:
//   PAGE_ORIGIN — адрес сайта Тапёра (например, https://alexshikaka.github.io) для CORS страницы телефона;
//                 не задана — «*» (страница открывается с другого адреса, если сайт ещё не настроен);
//   YDB_ENDPOINT, YDB_DATABASE — адрес базы; YDB_METADATA_CREDENTIALS=1 — вход сервисным аккаунтом функции.
// Общий ключ Тапёра (SHARED_KEY) здесь не нужен: страница телефона его не знает, а доступ к сессии
// защищён токеном host и лимитами частоты. Ключи и содержимое сессий в лог не пишутся — только op и код.
const core = require('./core');
const common = require('./shared');
const { ipOf } = common('ip');
const { readBody } = common('body');

// Тело host может нести снимок (64 КБ) + ленту (64 КБ) + до 10 событий по 16 КБ — около 300 КБ.
// 512 КБ — с запасом; это же значение проверяется до разбора JSON.
const MAX_BODY = 512 * 1024;
const JSON_UTF8 = 'application/json; charset=utf-8';

let store = null;
function getStore() {
  if (!store) store = process.env.TAPYOR_TEST_STORE === 'memory' ? core.memoryStore() : require('./store-ydb');
  return store;
}

function out(r) {
  const headers = Object.assign({ 'Content-Type': JSON_UTF8 }, r.headers || {});
  return { statusCode: r.status, headers, body: r.body == null ? '' : JSON.stringify(r.body) };
}

// Ошибки самого разбора запроса (до core.js). Странице телефона CORS нужен и на ошибке, иначе
// браузер покажет «нет связи» вместо понятного ответа.
function outError(status, error, code, op) {
  const headers = (op === 'poll' || op === 'cmd') ? core.corsHeaders() : {};
  return out({ status, headers, body: { error, tapyor_error: code } });
}

function coreCode(status, b) {
  const e = String((b && b.error) || '');
  if (status === 500) return 'server';
  if (status === 429) return 'rate_limited';
  if (status === 405) return 'method';
  if (status === 403) return 'forbidden';
  if (status === 400 && /^bad/.test(e)) return 'bad_request';
  return ''; // 404 no-session — обычный ответ, это не сбой облака
}

module.exports.handler = async function (event) {
  const e = event || {};
  const q = e.queryStringParameters || {};
  const op = String(q.op || '');
  const method = String(e.httpMethod || '');
  let body = {};

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const parsed = readBody(e, MAX_BODY);
    if (parsed.code === 'too_big') { console.log('remote: ' + (op || '?') + ' → 413'); return outError(413, 'too big', 'too_big', op); }
    if (parsed.code) { console.log('remote: ' + (op || '?') + ' → 400'); return outError(400, 'bad json', 'bad_request', op); }
    body = parsed.value;
  }

  try {
    const r = await core.handle(op, method, q, body, ipOf(e), getStore(), Date.now());
    console.log('remote: ' + (op || '?') + ' → ' + r.status);
    const code = coreCode(r.status, r.body);
    if (code) r.body = Object.assign({}, r.body, { tapyor_error: code });
    return out(r);
  } catch (err) {
    // В лог — только вид запроса и код: ни sid, ни host, ни тело не печатаем.
    console.log('remote: ' + (op || '?') + ' → 500 ' + String((err && (err.name || err.code)) || 'Error').slice(0, 40));
    return out({ status: 500, body: { error: 'server', tapyor_error: 'server' } });
  }
};

// Только для тестов: новое хранилище и сброс лимитов между проверками.
module.exports._reset = function () { store = null; core.resetRates(); };
