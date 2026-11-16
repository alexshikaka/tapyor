// Сервер активации модулей Тапёра (Yandex Cloud Functions, Node.js 22). Логика — core.js, база — store-ydb.js.
// Переменные окружения:
//   SHARED_KEY            — общий ключ Тапёра (как у yc-da / yc-google);
//   LICENSE_PRIVATE_KEY   — закрытый ключ licenses (PEM; переводы строк можно заменить на \n);
//   ADMIN_TOKEN           — пароль владельца для загрузки ключей;
//   YDB_ENDPOINT, YDB_DATABASE — адрес базы; YDB_METADATA_CREDENTIALS=1 — вход в базу сервисным аккаунтом функции.
// Ключи и токены в лог не пишутся.
//
// G-06: свои ошибки несут tapyor_error; поле error не менялось. Обычный ответ «ключа нет» (404 no-key)
// остаётся без tapyor_error — это не сбой облака, а честный ответ по существу.
// G-07: общий ключ, адрес клиента, ответ и разбор тела — в server/common/*.js.
'use strict';
const core = require('./core');
const { reply, errReply } = require('./common/reply');
const { keyOk } = require('./common/key');
const { ipOf } = require('./common/ip');
const { readBody } = require('./common/body');

// admin-keys: до 1000 хэшей. Один хэш — 64 знака плюс кавычки и запятая, т.е. ≈66 символов на запись:
// 1000 хэшей ≈ 66 КБ. Старый лимит 64 000 отсекал такую пачку (413), хотя 1000 разрешена в core.js. 96 КБ — с запасом.
const MAX_BODY = 96000;

// Ключ из переменной окружения: консоль может склеить строки PEM в одну (пробелами) или прислать \n буквально —
// собираем PEM заново из base64 между заголовками.
function normPem(v) {
  const s = String(v || '').replace(/\\n/g, '\n').trim();
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(s);
  // Поле в консоли однострочное — часто вставляется только середина ключа, без строк BEGIN/END. Принимаем и так.
  const body = (m ? m[1] : s).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(body) || Buffer.from(body, 'base64').length < 40) return '';
  return '-----BEGIN PRIVATE KEY-----\n' + (body.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n';
}
// Открытая половина ключа лицензий — та же, что зашита в Тапёре (src/license.js). Если в переменную вставили
// не тот закрытый ключ (например, ключ паков), функция честно скажет «не настроено», а не выдаст лицензии,
// которые Тапёр отвергнет. Проверяется один раз на экземпляр; значение ключа в лог не пишется.
const LICENSE_PUBKEYS = ['MCowBQYDK2VwAyEA/9tdSxNcIxeXPM1QakjeHV02xUnhbVyD4+44EtkwSrw='];
let keySeen = null, keyGood = '';
function keyCheck(pem) {
  if (pem === keySeen) return keyGood;
  keySeen = pem; keyGood = '';
  if (!pem) { console.log('license: LICENSE_PRIVATE_KEY не задан или не похож на ключ'); return ''; }
  try {
    const pub = require('crypto').createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');
    const test = process.env.TAPYOR_TEST_STORE === 'memory' && process.env.TAPYOR_TEST_PUBKEY; // только автотесты
    if (LICENSE_PUBKEYS.includes(pub) || pub === test) keyGood = pem;
    else console.log('license: LICENSE_PRIVATE_KEY — не тот ключ (не пара к ключу в Тапёре)');
  } catch (e) { console.log('license: LICENSE_PRIVATE_KEY не читается — ' + (e && e.message)); }
  return keyGood;
}
let store = null;
function getStore() { if (!store) store = process.env.TAPYOR_TEST_STORE === 'memory' ? core.memoryStore() : require('./store-ydb'); return store; }

// Ошибки ядра → код tapyor_error. Обычные ответы (200 и «ключа нет» 404) остаются как были.
function coreCode(status, bodyObj) {
  const e = String((bodyObj && bodyObj.error) || '');
  if (status === 500) return e === 'not-configured' ? 'not_configured' : 'server';
  if (status === 429) return 'rate_limited';
  if (status === 400 && /^bad/.test(e)) return 'bad_request';
  return '';
}

module.exports.normPem = normPem;
module.exports.keyCheck = keyCheck;
module.exports.handler = async function (event) {
  // L4: эта функция выдаёт платные лицензии, поэтому работает только с заданным SHARED_KEY — «закрыто по умолчанию».
  // Если ключ есть, но в запросе он не тот (или его нет) — прежний отказ 403.
  if (!keyOk(event, { required: true })) {
    if (!process.env.SHARED_KEY) console.log('license: SHARED_KEY не задан — функция закрыта (403). Задайте переменную окружения');
    else console.log('отклонён запрос без общего ключа');
    return errReply(403, 'forbidden', 'forbidden');
  }
  if ((event && event.httpMethod) !== 'POST') return errReply(405, 'only POST', 'method');
  const parsed = readBody(event, MAX_BODY);
  if (parsed.code === 'too_big') return errReply(413, 'too big', 'too_big');
  if (parsed.code) return errReply(400, 'bad json', 'bad_request');
  const req = parsed.value;
  try {
    const pem = keyCheck(normPem(process.env.LICENSE_PRIVATE_KEY));
    const r = await core.handle(req, getStore(), { privateKey: pem, adminToken: process.env.ADMIN_TOKEN || '', ip: ipOf(event), log: (m) => console.log(m) });
    console.log('license: ' + String(req.action || '?') + ' → ' + r.status + (r.body.error ? ' ' + r.body.error : ''));
    const code = coreCode(r.status, r.body);
    // Код добавляем только к своим сбоям; «ключа нет» и обычные ответы не трогаем
    if (!code) return reply(r.status, r.body);
    return reply(r.status, Object.assign({}, r.body, { tapyor_error: code }));
  } catch (e) {
    console.log('license: ошибка — ' + (e && e.message));
    return errReply(500, 'server', 'server');
  }
};
