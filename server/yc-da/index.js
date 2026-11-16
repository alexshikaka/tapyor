// Обмен кода DonationAlerts на токен — на стороне сервера.
// Зачем: client_secret DonationAlerts нельзя класть в установщик (достаётся из app.asar за минуту).
// Здесь он лежит в переменных окружения функции, а Тапёр присылает только код авторизации.
// Переменные окружения: DA_CLIENT_ID, DA_CLIENT_SECRET.
// Токены не логируются никогда — ни целиком, ни частями.
//
// G-06: свои ошибки несут поле tapyor_error (код из server/common/errors.js), поле error не менялось,
// чтобы Тапёр 0.32 и старше продолжал работать как раньше. Отказ самого DonationAlerts уходит БЕЗ
// tapyor_error — по нему видно, что это ответ провайдера, а не сбой нашего облака.
// G-07: лимит частоты, общий ключ, адрес клиента, ответ и разбор тела — в server/common/*.js.
'use strict';

const { reply, errReply, slowDown } = require('./common/reply');
const { keyOk } = require('./common/key');
const { createRate } = require('./common/rate');
const { readBody } = require('./common/body');

const TOKEN_URL = 'https://www.donationalerts.com/oauth/token';
const ALLOWED_GRANTS = new Set(['authorization_code', 'refresh_token']);
// Адрес возврата зашит в Тапёре; чужой сюда присылать незачем
const ALLOWED_REDIRECT = 'http://127.0.0.1:47219/da-callback';

// G-02/G-04: ограничения на время ответа провайдера и размер запроса
const PROVIDER_TIMEOUT_MS = 8000;
const MAX_BODY = 4000;

const rate = createRate();

module.exports.handler = async function (event) {
  if (!keyOk(event)) { console.log('отклонён запрос без общего ключа'); return errReply(403, 'forbidden', 'forbidden'); }

  if ((event && event.httpMethod) !== 'POST') return errReply(405, 'only POST', 'method');
  const wait = rate.wait(event);
  if (wait) { console.log('лимит частоты: 429 на ' + wait + ' с'); return slowDown(wait); }

  const id = process.env.DA_CLIENT_ID, secret = process.env.DA_CLIENT_SECRET;
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
    const redirect = String(req.redirect_uri || ALLOWED_REDIRECT);
    if (redirect !== ALLOWED_REDIRECT) return errReply(400, 'bad redirect_uri', 'bad_request');
    body.set('code', String(req.code));
    body.set('redirect_uri', redirect);
  } else {
    if (!req.refresh_token) return errReply(400, 'no refresh_token', 'bad_request');
    body.set('refresh_token', String(req.refresh_token));
    if (req.scope) body.set('scope', String(req.scope));
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
    if (!j) return errReply(502, 'DonationAlerts ответил не JSON, код ' + r.status, 'provider_bad_response');
    // В лог — только факт и код ответа, без значений
    console.log('da-token: grant=' + grant + ' status=' + r.status + ' token=' + (j.access_token ? 'да' : 'нет'));
    // Отказ провайдера (invalid_grant и прочее) — без tapyor_error: это ответ DonationAlerts, не наш сбой
    if (!r.ok || !j.access_token) return reply(r.ok ? 502 : r.status, { error: j.error || j.message || 'нет токена' });
    return reply(200, { access_token: j.access_token, refresh_token: j.refresh_token || '', expires_in: j.expires_in || 0 });
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.log('da-token: ' + (timeout ? 'таймаут ' + PROVIDER_TIMEOUT_MS + ' мс' : 'сеть — ' + (e && e.message)));
    return timeout
      ? errReply(504, 'провайдер не ответил вовремя', 'provider_timeout')
      : errReply(502, 'сеть недоступна', 'provider_unreachable');
  }
};

// Заглушка на случай, если правка выше когда-нибудь развалится: упасть понятно, а не молча
module.exports._rate = { wait: rate.wait, reset: rate.reset };
