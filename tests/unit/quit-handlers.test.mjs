// R12, п. 2 и 1: чистый выход. Опрос донатов должен останавливаться при выходе
// (раньше donations.stop() не звался вовсе, и таймеры опроса жили до конца процесса),
// а дочерние yt-dlp — гаситься. Проверка по исходнику main.js: обработчик will-quit —
// единственное место, где это видно без запуска Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function mainSource() {
  return fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
}

// Кусок от app.on('will-quit' до app.on('before-quit'): обе новые строки должны быть
// именно в обработчике выхода, а не где-то ещё в файле.
function willQuitBlock() {
  const src = mainSource();
  const start = src.indexOf("app.on('will-quit'");
  assert.ok(start >= 0, "в main.js есть app.on('will-quit')");
  const next = src.indexOf("app.on('before-quit'", start);
  assert.ok(next > start, 'после will-quit идёт before-quit');
  return src.slice(start, next);
}

function findLine(block, needle) {
  return block.split(/\r?\n/).find((l) => l.includes(needle)) || '';
}

test('выход: опрос донатов останавливается вместе со Streamer.bot', () => {
  const block = willQuitBlock();
  assert.ok(block.includes('sbotLink.stop()'), 'соседняя остановка на месте');
  assert.ok(findLine(block, 'donations.stop()'), 'в will-quit есть donations.stop()');
});

test('выход: дочерние yt-dlp гасятся через killAll()', () => {
  const block = willQuitBlock();
  assert.ok(findLine(block, 'killAll()'), 'в will-quit есть killAll()');
});

test('выход: обе остановки — в try, одна ошибка не срывает остальные', () => {
  const block = willQuitBlock();
  for (const needle of ['donations.stop()', 'killAll()']) {
    const line = findLine(block, needle).trim();
    assert.match(line, /^try\s*\{/, needle + ' — в try: ' + line);
    assert.match(line, /\}\s*catch\s*\(/, needle + ' — с catch: ' + line);
  }
});
