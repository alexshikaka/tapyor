// Понятный текст ошибок облака: код tapyor_error → русская фраза, подсказка о повторе и пустой ответ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ce = require('../../src/cloud-error.js');

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

test('explain: каждый из 11 кодов даёт свой текст', () => {
  for (const [code, text] of Object.entries(TEXTS)) {
    assert.equal(ce.explain({ tapyor_error: code }), text);
    assert.equal(ce.codeOf({ tapyor_error: code }), code);
  }
});

test('explain: неизвестный код и ответ без tapyor_error', () => {
  assert.equal(ce.explain({ tapyor_error: 'что-то' }), 'облако Тапёра ответило ошибкой (код: что-то)');
  assert.equal(ce.explain({}), '');
  assert.equal(ce.explain(null), '');
  assert.equal(ce.explain(undefined), '');
  assert.equal(ce.explain({ tapyor_error: '' }), '');
  assert.equal(ce.explain({ tapyor_error: '   ' }), '');
  assert.equal(ce.explain({ tapyor_error: 42 }), '');
  assert.equal(ce.codeOf({}), '');
});

test('explain: строка с JSON внутри разбирается, строка-мусор даёт пусто', () => {
  assert.equal(ce.explain('{"tapyor_error":"rate_limited"}'), TEXTS.rate_limited);
  assert.equal(ce.explain(' {"tapyor_error":"server"} '), TEXTS.server);
  assert.equal(ce.explain('не json'), '');
  assert.equal(ce.explain('null'), '');
  assert.equal(ce.explain('{"error":"forbidden"}'), '');
});

test('withRetry: «через N с» только для разумных чисел', () => {
  assert.equal(ce.withRetry('текст', { retry_after: 12 }), 'текст (через 12 с)');
  assert.equal(ce.withRetry('текст', { retry_after: 1 }), 'текст (через 1 с)');
  assert.equal(ce.withRetry('текст', { retry_after: 600 }), 'текст (через 600 с)');
  assert.equal(ce.withRetry('текст', { retry_after: 0 }), 'текст');
  assert.equal(ce.withRetry('текст', { retry_after: 700 }), 'текст');
  assert.equal(ce.withRetry('текст', { retry_after: '12' }), 'текст');
  assert.equal(ce.withRetry('текст', { retry_after: null }), 'текст');
  assert.equal(ce.withRetry('текст', {}), 'текст');
  assert.equal(ce.withRetry('текст', null), 'текст');
  assert.equal(ce.withRetry('текст', '{"retry_after":12}'), 'текст (через 12 с)');
});

// Списки кодов обязаны совпадать: если сервер добавит код, а Тапёр не научится его понимать,
// пользователь увидит «облако Тапёра ответило ошибкой (код: …)» вместо понятного текста.
test('коды сервера и Тапёра совпадают', () => {
  const { CODES } = require('../../server/common/errors.js');
  const ce = require('../../src/cloud-error.js');
  const server = Object.keys(CODES).sort();
  const shown = server.filter((c) => ce.explain({ tapyor_error: c }) !== 'облако Тапёра ответило ошибкой (код: ' + c + ')');
  assert.deepEqual(shown, server, 'у каждого кода сервера есть свой текст в Тапёре');
  // и наоборот: Тапёр не должен знать кодов, которых сервер не шлёт
  for (const c of server) assert.equal(ce.codeOf({ tapyor_error: c }), c);
  assert.equal(ce.explain({ tapyor_error: 'нет-такого-кода' }), 'облако Тапёра ответило ошибкой (код: нет-такого-кода)');
});
