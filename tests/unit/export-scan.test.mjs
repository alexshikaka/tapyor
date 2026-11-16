// Проверки снимка для открытого репозитория (tools/lib/export-scan.mjs).
// Образцы собираются из частей: сам файл теста не должен выглядеть как утечка при проверке снимка.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanText, scanImage, scanSnapshotDir, listImages, readDenylist, isTemplateUser } from '../../tools/lib/export-scan.mjs';

const DRIVE = 'E' + ':';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'export-scan-'));

// ── образцы картинок ────────────────────────────────────────────────────────────────────────────
function png(chunks) {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const [type, data] of chunks) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    parts.push(len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4));
  }
  parts.push(Buffer.from([0, 0, 0, 0]), Buffer.from('IEND', 'latin1'), Buffer.alloc(4));
  return Buffer.concat(parts);
}
function jpeg(segs) {
  const parts = [Buffer.from([0xff, 0xd8])];
  for (const [marker, data] of segs) {
    const len = Buffer.alloc(2); len.writeUInt16BE(data.length + 2);
    parts.push(Buffer.from([0xff, marker]), len, data);
  }
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}
const IHDR = [['IHDR', Buffer.from([0, 0, 1, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0])]];

test('пути ПК: ловятся все перечисленные формы', () => {
  const text = [
    DRIVE + '\\' + 'Tapyor' + '\\' + 'sandbox',
    DRIVE + '/' + 'Tapyor' + '/x',
    '/' + 'e' + '/' + 'Tapyor' + '/x',
    'E' + '--Tapyor-' + 'x',
    DRIVE + '/Users/' + 'realuser',
    '/' + 'c' + '/Users/' + 'realuser' + '/x',
    'file:///' + DRIVE + '/data',
    DRIVE + '\\\\' + 'Tapyor' + '\\\\' + 'x',
    DRIVE + '\\\\' + 'Users' + '\\\\' + 'realuser',
  ].join('\n');
  const found = scanText(text);
  assert.equal(found.length, 9);
  assert.ok(found.every((f) => f.kind === 'путь ПК'));
  assert.deepEqual(found.map((f) => f.line), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('пути ПК: шаблонные имена и диски PowerShell — не находка', () => {
  const clean = [
    DRIVE + '\\Users\\' + '<имя>',
    DRIVE + '\\Users\\' + '…',
    DRIVE + '\\Users\\' + 'user',
    DRIVE + '\\Users\\' + '%USERNAME%',
    'HKCU:\\Software\\' + 'Tapyor',
    '/home/' + 'user' + '/project',
  ].join('\n');
  assert.deepEqual(scanText(clean), []);
});

test('шаблонные имена пользователя распознаются', () => {
  for (const n of ['user', 'USERNAME', '<имя>', '…', '%USERNAME%', '...', 'Имя', 'test']) assert.equal(isTemplateUser(n), true, n);
  for (const n of ['alex', 'Иван', 'streamer42']) assert.equal(isTemplateUser(n), false, n);
});

test('список запрещённых слов: файл читается, комментарии пропускаются', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'deny.txt');
    fs.writeFileSync(file, '# комментарий\n"придуманныйзапрет"\n\nвтороеслово\n');
    const d = readDenylist(file);
    assert.equal(d.warning, '');
    assert.deepEqual(d.words, ['придуманныйзапрет', 'второеслово']);
    const found = scanText('тут придуманныйзапрет внутри', { denylist: d.words });
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, 'запрещённое слово');
    assert.equal(found[0].line, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('список запрещённых слов: файла нет — предупреждение, не ошибка', () => {
  const d = readDenylist(path.join(tmpDir(), 'нет-такого.txt'));
  assert.equal(d.words.length, 0);
  assert.match(d.warning, /не найден/);
});

test('запрещённое слово ищется целым словом, а не куском', () => {
  const found = scanText('слон и слонёнок', { denylist: ['слон'] });
  assert.equal(found.length, 1);
});

test('почта: личные адреса — находка, разрешённые — нет', () => {
  const mail = 'someone' + '@' + 'mail' + '.ru';
  const found = scanText('пиши: ' + mail);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'почта');
  const clean = ['noreply' + '@' + 'github.com', 'x' + '@' + 'users.noreply.github.com', 'a' + '@' + 'example.com', 'b' + '@' + 'example.org', 'c' + '@' + 'test.local', 'git' + '@' + 'github.com', 'https://user:pass' + '@' + 'github.com/', 'tray16' + '@' + '2x.png'].join(' ');
  assert.deepEqual(scanText(clean), []);
});

test('телефоны: международный формат — находка, число без плюса — нет', () => {
  const phone = '+' + '7 999 123-45-67';
  const found = scanText('звони ' + phone);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'телефон');
  assert.deepEqual(scanText('версия 7 999 123 45 67 и +5 градусов'), []);
});

test('внутренние заметки: пометки и служебные папки — находка', () => {
  const text = [
    'TODO' + '(владелец) доделать',
    'это не ' + 'публиковать',
    'внутрен' + 'нее дело',
    'only for ' + 'owner',
    'см. ' + 'handoff' + '\\' + 'x.md',
  ].join('\n');
  const found = scanText(text);
  assert.equal(found.length, 5);
  assert.ok(found.every((f) => f.kind === 'внутренняя заметка'));
});

test('внутренние заметки: обычный текст — не находка', () => {
  assert.deepEqual(scanText('внутренняя скорость вентилятора и публикация выпуска'), []);
});

test('PNG: текстовые блоки и eXIf — находка, чистый PNG — нет', () => {
  const dirty = png([...IHDR, ['tEXt', Buffer.from('Comment\0hi', 'latin1')], ['eXIf', Buffer.from([1, 2, 3])]]);
  const found = scanImage(dirty, 'a.png');
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.detail).sort(), ['PNG eXIf', 'PNG tEXt']);
  assert.deepEqual(scanImage(png(IHDR), 'clean.png'), []);
});

test('JPEG: APP1 и COM — находка, чистый JPEG — нет', () => {
  const dirty = jpeg([[0xe0, Buffer.from('JFIF', 'latin1')], [0xe1, Buffer.from('Exif\0\0', 'latin1')], [0xfe, Buffer.from('comment', 'latin1')]]);
  const found = scanImage(dirty, 'a.jpg');
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.detail).sort(), ['JPEG APP1 (EXIF/XMP)', 'JPEG COM']);
  assert.deepEqual(scanImage(jpeg([[0xe0, Buffer.from('JFIF', 'latin1')]]), 'clean.jpeg'), []);
});

test('SVG: metadata и атрибуты с путями — находка, чистый SVG — нет', () => {
  const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><metadata>x</metadata><g inkscape:label="' + DRIVE + '/x"></g></svg>';
  const found = scanImage(Buffer.from(dirty, 'utf8'), 'a.svg');
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.detail).sort(), ['SVG inkscape:label', 'SVG metadata']);
  const clean = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><rect/></svg>';
  assert.deepEqual(scanImage(Buffer.from(clean, 'utf8'), 'clean.svg'), []);
});

test('снимок во временной папке: подложенный образец — находка, чистый — нет', () => {
  const dirty = tmpDir(), clean = tmpDir();
  try {
    fs.writeFileSync(path.join(dirty, 'notes.txt'), 'путь ' + DRIVE + '\\' + 'Tapyor' + '\\' + 'x\n');
    fs.writeFileSync(path.join(dirty, 'pic.png'), png([...IHDR, ['tEXt', Buffer.from('Comment\0hi', 'latin1')]]));
    const found = scanSnapshotDir(dirty);
    assert.ok(found.some((f) => f.kind === 'путь ПК' && f.file === 'notes.txt'));
    assert.ok(found.some((f) => f.kind === 'картинка с метаданными' && f.file === 'pic.png'));
    fs.writeFileSync(path.join(clean, 'notes.txt'), 'обычный текст без данных\n');
    fs.writeFileSync(path.join(clean, 'pic.png'), png(IHDR));
    assert.deepEqual(scanSnapshotDir(clean), []);
  } finally {
    fs.rmSync(dirty, { recursive: true, force: true });
    fs.rmSync(clean, { recursive: true, force: true });
  }
});

test('почта: служебные адреса npm в package-lock.json — не находка, в других файлах — находка', () => {
  const mail = 'maintainer' + '@' + 'npmjs.com';
  assert.deepEqual(scanText('url: ' + mail, { file: 'package-lock.json' }), []);
  const found = scanText('url: ' + mail, { file: 'docs/x.md' });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'почта');
});

test('снимок: адрес в package-lock.json пропускается, в обычном файле — находка', () => {
  const dir = tmpDir();
  try {
    const mail = 'maintainer' + '@' + 'npmjs.com';
    fs.writeFileSync(path.join(dir, 'package-lock.json'), 'url ' + mail + '\n');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'почта ' + mail + '\n');
    const found = scanSnapshotDir(dir);
    assert.deepEqual(found.map((f) => f.file), ['notes.txt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('пометка export-scan:allow: строка не сканируется, соседняя — да', () => {
  const text = [
    DRIVE + '\\' + 'Tapyor' + '\\' + 'x  export-scan:allow',
    DRIVE + '\\' + 'Tapyor' + '\\' + 'y',
  ].join('\n');
  const found = scanText(text);
  assert.deepEqual(found.map((f) => [f.line, f.kind]), [[2, 'путь ПК']]);
});

test('список картинок: только картинки и с размером', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'a.png'), png(IHDR));
    fs.writeFileSync(path.join(dir, 'b.txt'), 'не картинка');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'c.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const imgs = listImages(dir);
    assert.deepEqual(imgs.map((x) => x.file), ['a.png', 'sub/c.svg']);
    assert.ok(imgs.every((x) => x.size > 0));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
