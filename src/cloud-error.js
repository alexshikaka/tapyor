'use strict';
// Понятный текст ошибок облачных функций Тапёра.
// Функция кладёт в тело ответа короткий код tapyor_error (forbidden, rate_limited, ...),
// а Тапёр показывает русскую фразу вместо сырого ответа провайдера или «вход не удался».
const TEXTS = {
  forbidden: 'облако Тапёра не приняло ключ этой версии — обнови Тапёр',
  method: 'облако Тапёра ответило не на тот запрос — попробуй ещё раз',
  rate_limited: 'облако Тапёра перегружено — попробуй через минуту',
  daily_limit: 'облако Тапёра сегодня приняло слишком много отчётов — попробуй завтра',
  not_configured: 'облако Тапёра не настроено — сообщи автору: у функции нет ключей сервиса',
  too_big: 'запрос к облаку Тапёра оказался слишком большим',
  bad_request: 'облако Тапёра не поняло запрос — попробуй ещё раз',
  provider_timeout: 'сервис не ответил вовремя — попробуй ещё раз',
  provider_unreachable: 'нет связи с сервисом — проверь интернет или VPN',
  provider_bad_response: 'сервис ответил непонятно — попробуй ещё раз',
  server: 'облако Тапёра сломалось — попробуй позже',
};

// Ответ облака может прийти готовым объектом, строкой тела или не прийти вовсе.
function toObject(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    try { v = JSON.parse(s); } catch (e) { return null; }
  }
  return v && typeof v === 'object' ? v : null;
}

// Код ошибки облака ('' — если это не наш ответ).
function codeOf(obj) {
  const o = toObject(obj);
  return o && typeof o.tapyor_error === 'string' ? o.tapyor_error.trim() : '';
}

// Текст для пользователя: '' — «нашей ошибки нет, показывай как раньше».
function explain(obj) {
  const code = codeOf(obj);
  if (!code) return '';
  if (Object.prototype.hasOwnProperty.call(TEXTS, code)) return TEXTS[code];
  return 'облако Тапёра ответило ошибкой (код: ' + code + ')';
}

// Облако может попросить подождать: retry_after в секундах. Тогда добавляем « (через N с)».
function withRetry(text, obj) {
  if (!text) return text;
  const o = toObject(obj);
  const n = o && typeof o.retry_after === 'number' ? o.retry_after : NaN;
  if (!isFinite(n) || n < 1 || n > 600) return text; // 0, 700, строки и мусор не показываем
  return text + ' (через ' + Math.round(n) + ' с)';
}

module.exports = { explain, withRetry, codeOf };
