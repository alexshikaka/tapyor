import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Шаблон Streamer.bot (E6): строка импорта лежит в ресурсах и попадает в сборку отдельным файлом.
// Здесь проверяем то, что легко сломать руками: строку одну, без хвоста, и запись extraResources.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = path.join(root, 'resources', 'streamerbot', 'tapyor-template.txt');
const SRC = path.join(root, 'resources', 'streamerbot', 'src');
const TEMPLATE_SHA256 = 'f66e9f67b69ab1a2c97b5ce0654472fb5c399555db98bd437698080872fb8369';

test('sbot-template: строка импорта — байт в байт, одной строкой, без перевода строки', () => {
  const buf = fs.readFileSync(file);
  assert.equal(buf.includes(0x0a), false, 'в строке нет \\n: Streamer.bot ждёт одну строку');
  assert.equal(buf.includes(0x0d), false, 'в строке нет \\r');
  assert.ok(buf.length > 10000, 'шаблон не обрезан');
  assert.match(buf.toString('utf8'), /^U0JBRR\+/, 'это строка импорта Streamer.bot (UUEncoded)');
  assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), TEMPLATE_SHA256,
    'шаблон изменился — обнови хеш в тесте вместе с экспортом из Streamer.bot');
});

test('sbot-template: исходники для сопровождения на месте, без stub/.dsh/decoded.json', () => {
  const names = fs.readdirSync(SRC);
  assert.equal(names.filter((n) => n.endsWith('.cs')).length, 13, '12 действий шаблона + 00-readme.cs');
  assert.ok(names.includes('BUILD.md'), 'BUILD.md — как собрать');
  assert.ok(names.includes('CHECK.md'), 'CHECK.md — как проверить');
  for (const bad of ['stub', '.dsh', 'decoded.json']) assert.equal(names.includes(bad), false, bad);
});

test('sbot-template: сборка берёт только строку, папка исходников в установщик не идёт', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const entry = (pkg.build.extraResources || []).find((x) => x.from === 'resources/streamerbot/tapyor-template.txt');
  assert.ok(entry, 'extraResources: шаблон кладётся в resources сборки');
  assert.equal(entry.to, 'streamerbot/tapyor-template.txt', 'путь совпадает с sbotTemplateFile в main.js');
  // В app.asar папка не нужна: шаблон и так лежит в resources через extraResources,
  // а исходники .cs — внутренние заметки. Раньше в asar дублировалась строка ~32 КБ (A35-16).
  assert.ok((pkg.build.files || []).includes('!resources/streamerbot${/*}'), 'папка streamerbot целиком не идёт в app.asar');
});
