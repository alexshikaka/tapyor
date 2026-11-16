// Смена канала обновлений (А12): разбор latest.yml, сверка sha512, сравнение версий.
// Зачем тест: по этим функциям программа решает, предлагать ли установку сборки другого канала,
// и проверяет, что скачанный установщик — тот самый файл. Ошибка здесь = подмена файла или
// «обновление» на тот же номер молча.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const rf = require('../../src/release-feed.js');

const sha = (buf) => crypto.createHash('sha512').update(buf).digest('base64');

const YML = (over = {}) => {
  const o = Object.assign({
    version: '0.33.0',
    file: 'Tapyor-Setup-0.33.0.exe',
    sha: sha(Buffer.from('ustanovshchik'))
  }, over);
  return [
    'version: ' + o.version,
    'files:',
    '  - url: ' + o.file,
    '    sha512: ' + o.sha,
    '    size: 12345678',
    'path: ' + o.file,
    'sha512: ' + o.sha,
    "releaseDate: '2026-11-11T00:00:00.000Z'"
  ].join('\n');
};

test('release-feed: версии сравниваются по числам, не по строкам', () => {
  assert.equal(rf.cmpVersion('0.33.0', '0.32.0'), 1);
  assert.equal(rf.cmpVersion('0.32.0', '0.33.0'), -1);
  assert.equal(rf.cmpVersion('0.32.0', '0.32.0'), 0);
  assert.equal(rf.cmpVersion('v0.32.10', '0.32.9'), 1, '0.32.10 новее 0.32.9');
  assert.equal(rf.cmpVersion('0.9.0', '0.10.0'), -1);
  assert.equal(rf.cmpVersion('мусор', '0.32.0'), null);
  assert.equal(rf.parseVersion('0.32.0-beta.1').join('.'), '0.32.0', 'хвост после дефиса отбрасывается');
});

test('release-feed: latest.yml разбирается — версия, файл, sha512', () => {
  const r = rf.parseLatestYml(YML());
  assert.equal(r.ok, true, r.error);
  assert.equal(r.version, '0.33.0');
  assert.equal(r.file, 'Tapyor-Setup-0.33.0.exe');
  assert.equal(r.sha512, sha(Buffer.from('ustanovshchik')));
});

test('release-feed: битый latest.yml — отказ, а не «обновлений нет»', () => {
  assert.equal(rf.parseLatestYml('').ok, false, 'пустой');
  assert.equal(rf.parseLatestYml('version: 0.33.0\npath: Tapyor.exe\n').ok, false, 'нет sha512');
  assert.equal(rf.parseLatestYml('version: не-версия\npath: A.exe\nsha512: ' + sha('x')).ok, false, 'нет версии');
  assert.equal(rf.parseLatestYml('version: 0.33.0\npath: setup.msi\nsha512: ' + sha('x')).ok, false, 'не .exe');
  assert.equal(rf.parseLatestYml('version: 0.33.0\npath: A.exe\nsha512: короткий').ok, false, 'sha512-мусор');
  assert.match(rf.parseLatestYml('version: 0.33.0').error, /файла/);
});

test('release-feed: подменённый файл не проходит сверку sha512', () => {
  const good = Buffer.from('ustanovshchik');
  const evil = Buffer.from('podmena');
  const want = sha(good);
  assert.equal(rf.checkSha512(good, want), true, 'тот самый файл — принят');
  assert.equal(rf.checkSha512(evil, want), false, 'другой файл — отказ');
  assert.equal(rf.checkSha512(good, sha(evil)), false, 'другой хеш — отказ');
  assert.equal(rf.checkSha512(Buffer.alloc(0), want), false, 'пустой файл — отказ');
  assert.equal(rf.checkSha512(good, ''), false, 'нет хеша — отказ');
  assert.equal(rf.checkSha512(good, 'AAAA'), false, 'мусор вместо хеша — отказ');
});

test('release-feed: что предложить после смены канала', () => {
  const same = { ok: true, version: '0.32.0' };
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'stable', same).verdict, 'same', 'тот же номер, другая сборка');
  assert.equal(rf.decideChannelOffer('0.32.0', 'stable', 'stable', same).sameBuild, true, 'та же сборка — кнопки нет');
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'stable', { ok: true, version: '0.33.0' }).verdict, 'newer');
  assert.equal(rf.decideChannelOffer('0.33.0', 'dev', 'stable', { ok: true, version: '0.32.0' }).verdict, 'older');
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'stable', null).verdict, 'empty');
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'stable', null).build, 'stable', 'пустой канал тоже знает свою сборку');
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'debug', null).build, 'dev');
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'stable', { ok: false, error: 'битый' }).verdict, 'error');
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'stable', { ok: false, error: 'битый' }).build, 'stable');
  assert.equal(rf.decideChannelOffer('0.32.0', 'dev', 'stable', { ok: true, version: '0.33.0' }).build, 'stable');
  assert.equal(rf.decideChannelOffer('0.32.0', 'stable', 'debug', { ok: true, version: '0.33.0' }).build, 'dev');
});

test('release-feed: качать можно только с GitHub владельца и его файлового хоста', () => {
  const u = rf.assetUrl('stable', 'Tapyor-Setup-0.33.0.exe');
  assert.equal(u, 'https://github.com/alexshikaka/tapyor/releases/latest/download/Tapyor-Setup-0.33.0.exe');
  assert.equal(rf.hostAllowed(u), true);
  assert.equal(rf.hostAllowed('https://objects.githubusercontent.com/abc'), true);
  assert.equal(rf.hostAllowed('https://example.com/Tapyor.exe'), false, 'чужой адрес — отказ');
  assert.equal(rf.hostAllowed('http://github.com/x'), false, 'не https — отказ');
  assert.equal(rf.hostAllowed('javascript:alert(1)'), false);
  assert.match(rf.feedReleaseUrl('debug'), /tapyor-releases/);
  assert.match(rf.feedReleaseUrl('stable'), /alexshikaka\/tapyor\//);
});

// B7b (P5a №12): версия из latest.yml попадает в имя файла установщика. Раньше проверялось
// только начало строки, поэтому «0.36.0/../../…» проходило и могло писать за пределы папки.
test('release-feed: номер версии — строгий (никаких путей в имени файла)', () => {
  assert.equal(rf.safeVersion('0.36.0'), true);
  assert.equal(rf.safeVersion('0.36.0-beta.1'), true);
  assert.equal(rf.safeVersion('0.36.0-rc.2'), true);
  for (const v of [
    '0.36.0/../../evil', '0.36.0\\..\\evil', '0.36', '0.36.0.1', 'v0.36.0', ' 0.36.0', '0.36.0 ',
    '0.36.0-beta/../x', '0.36.0/evil', '', null, undefined, 'мусор', '0.36.0-', '0.36.0-beta_1',
  ]) {
    assert.equal(rf.safeVersion(v), false, 'должно быть отвергнуто: ' + String(v));
  }
});

test('release-feed: latest.yml с версией-путём не принимается', () => {
  assert.equal(rf.parseLatestYml(YML({ version: '0.36.0/../../evil' })).ok, false);
  assert.match(rf.parseLatestYml(YML({ version: '0.36.0/../../evil' })).error, /верси/i);
  assert.equal(rf.parseLatestYml(YML({ version: '0.36' })).ok, false);
  assert.equal(rf.parseLatestYml(YML({ version: '0.33.0' })).ok, true, 'обычная версия — можно');
});

// B7b (P5a №15): файл подписи качается из релиза конкретной версии (тег vX.Y.Z), а не из
// latest/download. Иначе после выхода новой версии старый .sig даёт 404 и подпись «теряется».
test('release-feed: адрес файла подписи — по тегу версии', () => {
  const u = rf.assetUrlAtVersion('stable', '0.36.0', 'Tapyor-Setup-0.36.0.exe.sig');
  assert.equal(u, 'https://github.com/alexshikaka/tapyor/releases/download/v0.36.0/Tapyor-Setup-0.36.0.exe.sig');
  assert.equal(rf.hostAllowed(u), true);
  const d = rf.assetUrlAtVersion('debug', '1.2.3-beta.1', 'Tapyor-Setup-1.2.3-beta.1.exe.sig');
  assert.equal(d, 'https://github.com/alexshikaka/tapyor-releases/releases/download/v1.2.3-beta.1/Tapyor-Setup-1.2.3-beta.1.exe.sig');
  assert.equal(rf.hostAllowed(d), true);
  assert.equal(rf.assetUrlAtVersion('stable', '0.36.0/../x', 'a.exe.sig'), '', 'версия-путь');
  assert.equal(rf.assetUrlAtVersion('stable', '0.36.0', '../a.exe.sig'), '', 'путь вместо имени');
  assert.equal(rf.assetUrlAtVersion('stable', '0.36.0', 'a/b.sig'), '', 'папка вместо имени');
  assert.equal(rf.assetUrlAtVersion('stable', '0.36.0', ''), '');
  assert.equal(rf.assetUrlAtVersion('stable', '0.36.0', null), '');
});
