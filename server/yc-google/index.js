// Обмен кода Google на токен — на стороне сервера.
// Зачем: client_secret не должен лежать в установщике. Google для десктопных клиентов
// считает его неконфиденциальным, но к версии с открытым кодом секретов в пакете быть не должно.
// Переменные окружения: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
// Токены не логируются никогда.
//
// G-06: свои ошибки несут tapyor_error, поле error не менялось (Тапёр 0.32 и старше работают как раньше).
// Отказ Google (invalid_grant и т.п.) уходит БЕЗ tapyor_error: ytoauth.js по invalid_grant чистит вход.
// G-07: лимит частоты, общий ключ, адрес клиента, ответ и разбор тела — в server/common/*.js.
'use strict';

const { reply, errReply, slowDown } = require('./common/reply');
const { keyOk } = require('./common/key');
const { createRate } = require('./common/rate');
const { readBody } = require('./common/body');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ALLOWED_GRANTS = new Set(['authorization_code', 'refresh_token']);
// У Google порт возврата случайный (выбирается при каждом входе), поэтому проверяем форму адреса,
// а не точное значение: только localhost и только путь /cb.
const REDIRECT_OK = /^http:\/\/127\.0\.0\.1:\d{1,5}\/cb$/;

// G-02/G-04: ограничения на время ответа провайдера и размер запроса
const PROVIDER_TIMEOUT_MS = 8000;
const MAX_BODY = 4000;

const rate = createRate();

module.exports.handler = async function (event) {
  if (!keyOk(event)) { console.log('отклонён запрос без общего ключа'); return errReply(403, 'forbidden', 'forbidden'); }

  if ((event && event.httpMethod) !== 'POST') return errReply(405, 'only POST', 'method');
  const wait = rate.wait(event);
  if (wait) { console.log('лимит частоты: 429 на ' + wait + ' с'); return slowDown(wait); }

  const id = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return errReply(500, 'not-configured', 'not_configured');

  const parsed = readBody(event, MAX_BODY);
  if (parsed.code === 'too_big') return errReply(413, 'too big', 'too_big');
  if (parsed.code) return errReply(400, 'bad json', 'bad_request');
  const req = parsed.value;

  const grant = String(req.grant_type || '');
  if (!ALLOWED_GRANTS.has(grant)) return errReply(400, 'bad grant_type', 'bad_request');

  const body = new URLSearchParams({ grant_type: grant, client_id: id, client_secret: secret });
  if (grant === 'authorization_code') {
    if (!req.code) return errReply(400, 'no code', 'bad_request');
    const redirect = String(req.redirect_uri || '');
    if (!REDIRECT_OK.test(redirect)) return errReply(400, 'bad redirect_uri', 'bad_request');
    body.set('code', String(req.code));
    body.set('redirect_uri', redirect);
    // PKCE: проверку всё равно делает Google, мы только передаём
    if (req.code_verifier) body.set('code_verifier', String(req.code_verifier));
  } else {
    if (!req.refresh_token) return errReply(400, 'no refresh_token', 'bad_request');
    body.set('refresh_token', String(req.refresh_token));
  }

  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) // G-02: зависший провайдер не держит функцию
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (!j) return errReply(502, 'Google ответил не JSON, код ' + r.status, 'provider_bad_response');
    console.log('google-token: grant=' + grant + ' status=' + r.status + ' token=' + (j.access_token ? 'да' : 'нет'));
    if (!r.ok || !j.access_token) {
      // error пробрасываем как есть: ytoauth.js по invalid_grant чистит сохранённый вход
      return reply(r.ok ? 502 : r.status, { error: j.error || 'нет токена', error_description: j.error_description || '' });
    }
    return reply(200, {
      access_token: j.access_token,
      refresh_token: j.refresh_token || '',
      expires_in: j.expires_in || 0,
      scope: j.scope || ''
    });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.log('google-token: ' + (timeout ? 'таймаут ' + PROVIDER_TIMEOUT_MS + ' мс' : 'сеть — ' + (e && e.message)));
    return timeout
      ? errReply(504, 'провайдер не ответил вовремя', 'provider_timeout')
      : errReply(502, 'сеть недоступна', 'provider_unreachable');
  }
};

module.exports._rate = { wait: rate.wait, reset: rate.reset };
