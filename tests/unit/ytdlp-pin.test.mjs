// Закреплённая версия yt-dlp: разбор resources/yt-dlp.version.json (P5a №7).
// Пустая версия — прежнее поведение «latest», но со предупреждением в CI.
import { test } from 'node:test';
import assert from 'node:assert';
import { checkPin } from '../../tools/lib/ytdlp-pin.mjs';

test('пустая версия — latest, без ошибки', () => {
  const r = checkPin('{ "version": "", "sha256": "" }');
  assert.equal(r.ok, true);
  assert.equal(r.pinned, false);
});

test('закреплённая версия с sha256 — ok', () => {
  const r = checkPin(JSON.stringify({ version: '2025.01.15', sha256: 'a'.repeat(64) }));
  assert.equal(r.ok, true);
  assert.equal(r.pinned, true);
  assert.equal(r.version, '2025.01.15');
});

test('версия без sha256 — ошибка', () => {
  const r = checkPin(JSON.stringify({ version: '2025.01.15', sha256: '' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /sha256/);
});

test('sha256 без версии — ошибка', () => {
  const r = checkPin(JSON.stringify({ version: '', sha256: 'a'.repeat(64) }));
  assert.equal(r.ok, false);
});

test('кривая версия — ошибка', () => {
  assert.equal(checkPin(JSON.stringify({ version: 'latest', sha256: 'a'.repeat(64) })).ok, false);
});

test('кривой sha256 — ошибка', () => {
  assert.equal(checkPin(JSON.stringify({ version: '2025.01.15', sha256: 'zz' })).ok, false);
});

test('битый JSON — ошибка', () => {
  assert.equal(checkPin('{').ok, false);
});
