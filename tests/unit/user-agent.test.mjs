// B14: user-agent должен нести настоящую мажорную версию Chromium,
// а при неизвестной версии — прежнюю строку Chrome/130.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { userAgent, FALLBACK_UA } = require('../../src/user-agent.js');

const prefix = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/';
const suffix = '.0.0.0 Safari/537.36';

test('user-agent: настоящая версия Chromium подставляется в строку', () => {
  assert.equal(userAgent('152.0.7444.60'), prefix + '152' + suffix);
  assert.equal(userAgent('999.1.2.3'), prefix + '999' + suffix);
});

test('user-agent: без версии — прежняя строка Chrome/130', () => {
  assert.equal(userAgent(''), FALLBACK_UA);
  assert.equal(userAgent(null), FALLBACK_UA);
  assert.equal(userAgent('   '), FALLBACK_UA);
  assert.match(FALLBACK_UA, /Chrome\/130\.0\.0\.0 Safari\/537\.36$/);
});

test('user-agent: мусор вместо версии не попадает в строку', () => {
  for (const bad of ['мусор', 'Chrome/152', 'v152.0', '152abc', '0.0.0.0', '-1.0']) {
    assert.equal(userAgent(bad), FALLBACK_UA, 'для «' + bad + '» должна быть прежняя строка');
  }
});

test('user-agent: без аргумента берёт версию текущего процесса, а в Node её нет — прежняя строка', () => {
  if (process.versions.chrome) {
    assert.match(userAgent(), /Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    assert.ok(!userAgent().includes('Chrome/130.0.0.0'), 'версия процесса не должна подменяться старой');
  } else {
    assert.equal(userAgent(), FALLBACK_UA);
  }
});
