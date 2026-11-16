// T1: дополнение к cloud-check.test.mjs — таблица причин, проверка с поддельным fetch,
// сводка для строки быстрой проверки и отсутствие сети без запроса.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../src/cloud-check.js');

test('cloud-check: таблица причин заполнена, у плохих есть куда смотреть', () => {
  for (const [k, v] of Object.entries(C.KINDS)) {
    assert.ok(['ok', 'bad', 'warn'].includes(v.state), k);
    assert.ok(v.text, k);
    if (k !== 'ok') {
      assert.ok(v.where, k);
      assert.match(v.link, /^https:\/\//, k);
    }
  }
  assert.match(C.BILLING, /^https:\/\/center\.yandex\.cloud\//);
  assert.match(C.CONSOLE, /^https:\/\/console\.yandex\.cloud/);
});

test('cloud-check.classify: коды и тексты ответов переводятся в причину', () => {
  assert.equal(C.classify(405, JSON.stringify({ error: 'method not allowed' })), 'ok');
  assert.equal(C.classify(403, JSON.stringify({ error: 'forbidden' })), 'key');
  assert.equal(C.classify(403, JSON.stringify({ error: 'другое' })), 'billing');
  assert.equal(C.classify(403, 'forbidden'), 'billing');
  assert.equal(C.classify(402, ''), 'billing');
  assert.equal(C.classify(500, 'payment failed'), 'billing', 'текст про оплату важнее кода');
  assert.equal(C.classify(429, ''), 'quota');
  assert.equal(C.classify(404, ''), 'missing');
  assert.equal(C.classify(500, ''), 'error');
  assert.equal(C.classify(502, 'bad gateway'), 'error');
  assert.equal(C.classify(200, ''), 'ok');
  assert.equal(C.classify(302, ''), 'ok');
});

test('cloud-check.classify: сеть и пустой статус — «не отвечает»', () => {
  assert.equal(C.classify(0, '', new Error('нет сети')), 'net');
  assert.equal(C.classify(0, ''), 'net');
  assert.equal(C.classify(null, '', null), 'net');
  assert.equal(C.classify(undefined, ''), 'net');
});

test('cloud-check.check: поддельный fetch, ключ в заголовке и порядок по id', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('bad')) return { status: 500, text: async () => 'упало' };
    return { status: 405, text: async () => JSON.stringify({ error: 'method not allowed' }) };
  };
  const out = await C.check([
    { id: 'report', url: 'https://ok/report' },
    { id: 'da', url: 'https://bad/da' },
    { id: 'google', url: '' },
  ], { fetch: fake, key: 'ключ', keyHeader: 'X-Key', timeoutMs: 1000 });
  assert.deepEqual(out.map((x) => x.id), ['da', 'report']);
  assert.equal(out[0].kind, 'error');
  assert.equal(out[1].kind, 'ok');
  assert.equal(calls.length, 2, 'цель без адреса не запрашивается');
  assert.equal(calls[0].opts.headers['X-Key'], 'ключ');
  assert.ok(calls[0].opts.signal, 'есть ограничение по времени');
  assert.equal(out[1].name, 'отчёты об ошибках');
});

test('cloud-check.check: падение fetch и падение чтения текста не бросают', async () => {
  const thrown = await C.check([{ id: 'da', url: 'https://x' }], { fetch: async () => { throw new Error('нет сети'); }, key: '', keyHeader: 'X', timeoutMs: 100 });
  assert.equal(thrown[0].kind, 'net');
  const textFail = await C.check([{ id: 'da', url: 'https://x' }], { fetch: async () => ({ status: 500, text: async () => { throw new Error('обрыв'); } }), key: '', keyHeader: 'X', timeoutMs: 100 });
  assert.equal(textFail[0].kind, 'error');
});

test('cloud-check.summary: пусто, всё хорошо, отказ и предупреждение', () => {
  assert.deepEqual(C.summary([]), { state: 'off', text: 'не настроены (сборка без облака)' });
  assert.deepEqual(C.summary([{ kind: 'ok', name: 'A' }]), { state: 'ok', text: 'все 1 на связи' });

  const bad = C.summary([
    { kind: 'ok', name: 'A', state: 'ok' },
    { kind: 'error', name: 'B', state: 'bad', text: 'ошибка внутри функции', where: 'смотри логи', link: 'https://x', status: 500 },
  ]);
  assert.equal(bad.state, 'bad');
  assert.ok(bad.text.includes('B: ошибка внутри функции'));
  assert.ok(bad.details.includes('смотри логи'));
  assert.ok(bad.details.includes('HTTP 500'));
  assert.equal(bad.where[0].name, 'B');

  const warn = C.summary([{ kind: 'net', name: 'A', state: 'warn', text: 'не отвечает', where: 'интернет', link: 'https://x', status: 0 }]);
  assert.equal(warn.state, 'warn');
});

test('cloud-check.summary: «сломано» важнее «предупреждения»', () => {
  const s = C.summary([
    { kind: 'net', name: 'A', state: 'warn', text: 'не отвечает', where: 'x', link: 'https://x' },
    { kind: 'missing', name: 'B', state: 'bad', text: 'функция не найдена', where: 'y', link: 'https://y' },
  ]);
  assert.equal(s.state, 'bad');
});

test('cloud-check.readProxy: нет файла — пустая строка, без исключения', () => {
  assert.equal(C.readProxy('такого-файла-нет-12345.json'), '');
});
