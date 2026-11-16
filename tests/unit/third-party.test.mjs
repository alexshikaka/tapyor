// THIRD-PARTY.md — полный список того, что идёт в установщик (D2, F5).
// Зачем тест: новый пакет в dependencies, не упомянутый в документе, — это забытая лицензия.
// Проверяем каждый пакет dependencies, версию из package-lock, Electron из package.json,
// hls.js, шрифты (OFL) и yt-dlp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const doc = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8');

test('THIRD-PARTY: каждый пакет dependencies упомянут с точной версией', () => {
  const missing = [];
  for (const name of Object.keys(pkg.dependencies || {}).sort()) {
    if (!doc.includes(name)) { missing.push(name + ' (нет названия)'); continue; }
    const ver = lock.packages && lock.packages['node_modules/' + name] && lock.packages['node_modules/' + name].version;
    if (ver && !doc.includes(ver)) missing.push(name + ' (нет версии ' + ver + ')');
  }
  assert.deepEqual(missing, [], 'не перечислены в THIRD-PARTY.md:\n' + missing.join('\n'));
});

test('THIRD-PARTY: Electron, hls.js, шрифты (OFL) и yt-dlp названы', () => {
  const electron = pkg.devDependencies && pkg.devDependencies.electron;
  assert.ok(electron, 'версии Electron нет в package.json');
  assert.ok(doc.includes(String(electron)), 'нет версии Electron ' + electron);
  assert.match(doc, /hls\.js/, 'нет hls.js');
  assert.match(doc, /yt-dlp/, 'нет yt-dlp');
  assert.match(doc, /OFL/, 'нет лицензии шрифтов OFL');
});

test('шрифты: текст лицензии лежит рядом с файлами (F5)', () => {
  const fonts = path.join(ROOT, 'src', 'assets', 'fonts');
  const files = fs.readdirSync(fonts);
  assert.ok(files.some((f) => f.endsWith('.woff2')), 'нет файлов шрифтов');
  assert.ok(files.includes('OFL.txt'), 'нет src/assets/fonts/OFL.txt');
  const ofl = fs.readFileSync(path.join(fonts, 'OFL.txt'), 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
});
