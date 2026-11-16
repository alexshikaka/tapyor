// Чистые функции проверки установщика (tools/check-asar.mjs → tools/lib/asar-scan.mjs).
// Значения в тестах выдуманные: настоящих ключей здесь нет.
import { test } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { findSecrets, findJunk, findDuplicates, isProbableText, isDependencyPath } from '../../tools/lib/asar-scan.mjs';

const HEX32 = '0123456789abcdef'.repeat(2);

test('секрет под другим именем поля (apiKey) — находка', () => {
  const found = findSecrets(JSON.stringify({ apiKey: HEX32 }));
  assert.ok(found.length >= 1, 'должна быть находка');
  assert.equal(typeof found[0].line, 'number');
});

test('секрет в текстовом файле под именем token — находка', () => {
  const found = findSecrets('token = "' + 'github_pat_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"');
  assert.ok(found.length >= 1, 'должна быть находка');
});

test('чистый файл — находок нет', () => {
  const clean = JSON.stringify({ clientId: 'public-id', proxyUrl: 'https://example.org/fn' });
  assert.deepEqual(findSecrets(clean), []);
});

test('значение из белого списка (по хешу) — не находка', () => {
  const fake = 'feedfacecafebeefdeadbeef01234567';
  const hash = createHash('sha256').update(fake).digest('hex');
  const found = findSecrets(JSON.stringify({ apiKey: fake }), { allowedHashes: new Set([hash]) });
  assert.deepEqual(found, []);
});

test('замена <REDACTED_…> находкой не считается', () => {
  assert.deepEqual(findSecrets('{"apiKey":"<REDACTED_KEY>"}'), []);
});

test('лишние файлы: public/, package-lock.json, docs, корневые .md', () => {
  const junk = findJunk(['/public/README.md', '/package-lock.json', '/docs/a.md', '/README.md', '/src/main.js']);
  assert.deepEqual(junk, ['/public/README.md', '/package-lock.json', '/docs/a.md', '/README.md']);
});

test('один и тот же файл в asar и extraResources — находка', () => {
  const dups = findDuplicates(
    [{ path: '/resources/yt-dlp.exe', sha256: 'aaa', size: 10 }],
    [{ path: '/yt-dlp.exe', sha256: 'aaa', size: 10 }]
  );
  assert.equal(dups.length, 1);
  assert.equal(dups[0].extra, '/yt-dlp.exe');
});

test('разные файлы и пустые файлы — не находки', () => {
  assert.deepEqual(findDuplicates(
    [{ path: '/resources/a.bin', sha256: 'aaa', size: 10 }],
    [{ path: '/b.bin', sha256: 'bbb', size: 10 }]
  ), []);
  assert.deepEqual(findDuplicates(
    [{ path: '/a.txt', sha256: 'empty', size: 0 }],
    [{ path: '/b.txt', sha256: 'empty', size: 0 }]
  ), []);
});

test('текстовые и двоичные файлы различаются', () => {
  assert.equal(isProbableText('app.json', Buffer.from('{"a":1}')), true);
  assert.equal(isProbableText('yt-dlp.exe', Buffer.from('MZ...')), false);
  assert.equal(isProbableText('data', Buffer.from([0x41, 0x00, 0x42])), false);
  assert.equal(isProbableText('script', Buffer.from('const a = 1;')), true);
});

test('чужие пакеты node_modules не считаются своими файлами', () => {
  assert.equal(isDependencyPath('/node_modules/x/a.js'), true);
  assert.equal(isDependencyPath('node_modules/x/a.js'), true);
  assert.equal(isDependencyPath('\\node_modules\\x\\a.js'), true);
  assert.equal(isDependencyPath('/src/main.js'), false);
});

// Публичный ключ Last.fm в extraResources — не находка, но только в точном виде (Claude, приёмка B7a 13.11).
test('lastfm.json с одним apiKey из 32 hex — разрешён; другое — нет', async () => {
  const { isPublicLastfmKey } = await import('../../tools/lib/asar-scan.mjs');
  const k = 'ab'.repeat(16);
  assert.equal(isPublicLastfmKey('extraResources/lastfm.json', JSON.stringify({ apiKey: k })), true);
  assert.equal(isPublicLastfmKey('extraResources/lastfm.json', JSON.stringify({ apiKey: k, secret: k })), false);
  assert.equal(isPublicLastfmKey('extraResources/lastfm.json', JSON.stringify({ apiKey: k + 'x' })), false);
  assert.equal(isPublicLastfmKey('extraResources/other.json', JSON.stringify({ apiKey: k })), false);
  assert.equal(isPublicLastfmKey('extraResources/lastfm.json', 'не json'), false);
});

// Открытый clientId Google + адрес облачной функции в src/google-oauth.json — не находка (секрет Google живёт
// только в облаке, CLAUDE.md «Ключи и секреты»). Найдено на сборке 0.36.0: CI остановил выпуск (Claude, 13.11).
test('google-oauth.json только с clientId и https proxyUrl — разрешён; другое — нет', async () => {
  const { isPublicGoogleOauth } = await import('../../tools/lib/asar-scan.mjs');
  const id = '1234567890' + '-' + 'abcdef0123' + '.apps.googleusercontent.com';
  const url = 'https://functions.example.net/fn';
  const ok = JSON.stringify({ clientId: id, proxyUrl: url });
  assert.equal(isPublicGoogleOauth(String.raw`\src\google-oauth.json`, ok), true);
  assert.equal(isPublicGoogleOauth('/src/google-oauth.json', ok), true);
  assert.equal(isPublicGoogleOauth('/src/google-oauth.json', JSON.stringify({ clientId: id })), true);
  assert.equal(isPublicGoogleOauth('/src/other.json', ok), false, 'другое имя файла');
  assert.equal(isPublicGoogleOauth('/src/google-oauth.json', JSON.stringify({ clientId: id, proxyUrl: url, clientSecret: 'x' })), false, 'лишнее поле');
  assert.equal(isPublicGoogleOauth('/src/google-oauth.json', JSON.stringify({ clientId: 'GOCSPX-' + 'a'.repeat(20) })), false, 'секрет вместо id');
  assert.equal(isPublicGoogleOauth('/src/google-oauth.json', JSON.stringify({ clientId: id, proxyUrl: 'http://x' })), false, 'не https');
  assert.equal(isPublicGoogleOauth('/src/google-oauth.json', 'не json'), false);
});
