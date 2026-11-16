// R5: кэши не пишутся поверх файла. Обрыв посреди записи не должен оставить
// половинчатый JSON — три кэша обязаны идти через src/atomic-write.js.
// Поведение при сбое записи — как раньше: пишем в журнал (где он есть) и работаем дальше.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const atomic = require('../../src/atomic-write.js');
const vpn = require('../../src/vpn-nets-live.js');

const root = path.resolve(import.meta.dirname, '..', '..');
function source(name) { return fs.readFileSync(path.join(root, 'src', name), 'utf8'); }

test('кэши пишут через общий atomic-write, а не поверх файла', () => {
  for (const name of ['recipes.js', 'online-lookup.js', 'vpn-nets-live.js']) {
    const s = source(name);
    assert.equal(/writeFileSync\s*\(/.test(s), false, name + ': остался прямой writeFileSync');
    assert.match(s, /writeFileAtomic\s*\(/, name + ': запись не через atomic-write');
  }
});

test('vpn-nets-live: writeCache пишет через atomic-write и не падает при ошибке', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-vpncache-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} });
  const orig = atomic.writeFileAtomic;
  const seen = [];
  t.after(() => { atomic.writeFileAtomic = orig; });
  atomic.writeFileAtomic = (file, text) => { seen.push({ file, text }); return true; };

  vpn.writeCache(dir, ['1.2.3.0/24']);
  assert.equal(seen.length, 1, 'запись ушла в общий модуль');
  assert.equal(seen[0].file, vpn.cacheFile(dir));
  assert.match(seen[0].text, /1\.2\.3\.0\/24/);

  atomic.writeFileAtomic = () => { throw new Error('диск занят'); };
  assert.doesNotThrow(() => vpn.writeCache(dir, ['5.6.7.0/24']), 'ошибка записи не роняет программу');
});
