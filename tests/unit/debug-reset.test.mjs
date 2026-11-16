// 0.34.0, задание 4: правила отладочных сбросов.
// Без Electron: только чистые функции и временная папка для .bak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const reset = require('../../src/debug-reset.js');

const made = [];
function tmpRoot(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-unit-reset-' + tag + '-'));
  made.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
});
function tok(obj) {
  const p = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'tpl1.' + p + '.sig';
}

const DEFAULTS = { theme: 'violet', perfWatch: true, crossfade: 6, hotkeys: { playPause: 'Ctrl+Alt+P' } };

test('сброс настроек: заводские значения, входы/ключи/лицензии/плейлисты/темы целы', () => {
  const data = {
    theme: 'c:my', themeBar: { bg: '#15161C', sym: '#C5C6CC' },
    perfWatch: false, crossfade: 0, hotkeys: { playPause: 'X' },
    nowPlayingPath: 'C:\\Users\\Test\\now_playing.txt',   // не входит в DEFAULTS — пропадает
    savedLists: [{ src: 'tap', title: 'Мой' }],
    themes: [{ id: 'c:my', name: 'Своя' }],
    modLicenses: { 'streamer-pack': [tok({ kind: 'full' })] },
    licClockMax: 1762800000000,
    modLicenseKey: 'TPR-OLD',
    'modSecure.streamer-pack.core.licenseKey': 'enc-key',
    'modSecure.streamer-pack.bot.token': 'enc-token',
    ymToken: 'enc-ym', ytCookies: 'enc-yt', ytOauth: { account: 'x' }, ytOauthAccount: { name: 'x' },
    ytOauthScope: 'auth/youtube', ytAccount: { name: 'x' },
    donKeys: { da: 'enc' }, donAccounts: { da: { name: 'x' } }, ghToken: 'enc-gh', ghAccount: { login: 'x' }
  };
  const r = reset.resetSettings(data, DEFAULTS);
  // Выбранная тема остаётся: задание №L1 требует «плейлисты и тема на месте».
  assert.equal(r.theme, 'c:my');
  assert.deepEqual(r.themeBar, data.themeBar);
  assert.equal(r.perfWatch, true);
  assert.equal(r.crossfade, 6);
  assert.deepEqual(r.hotkeys, { playPause: 'Ctrl+Alt+P' });
  assert.equal(r.nowPlayingPath, undefined);
  for (const k of ['savedLists', 'themes', 'theme', 'themeBar', 'modLicenses', 'licClockMax', 'modLicenseKey',
    'modSecure.streamer-pack.core.licenseKey', 'modSecure.streamer-pack.bot.token',
    'ymToken', 'ytCookies', 'ytOauth', 'ytOauthAccount', 'ytOauthScope', 'ytAccount',
    'donKeys', 'donAccounts', 'ghToken', 'ghAccount']) {
    assert.deepEqual(r[k], data[k], 'сохранён ' + k);
  }
});

test('сброс настроек правит только .bak* и не трогает другие файлы', () => {
  const dir = tmpRoot('bak');
  const file = path.join(dir, 'settings.json');
  const data = { theme: 'violet', licClockMax: 5 };
  fs.writeFileSync(file, '{"current":true}');
  for (const f of ['settings.json.bak', 'settings.json.bak.1', 'settings.json.bak.4']) fs.writeFileSync(path.join(dir, f), '{"old":true}');
  fs.writeFileSync(path.join(dir, 'settings.json.bak.old'), 'keep');
  fs.writeFileSync(path.join(dir, 'requests.json'), 'keep');
  const n = reset.rewriteBackups(file, data);
  assert.equal(n, 3);
  const json = JSON.stringify(data, null, 2);
  for (const f of ['settings.json.bak', 'settings.json.bak.1', 'settings.json.bak.4']) {
    assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), json);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json.bak.old'), 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"current":true}');
  assert.equal(fs.readFileSync(path.join(dir, 'requests.json'), 'utf8'), 'keep');
});

test('сброс настроек правит и суточные копии (иначе store поднимет старые настройки)', () => {
  const dir = tmpRoot('bakday');
  const file = path.join(dir, 'settings.json');
  const data = { theme: 'violet' };
  fs.writeFileSync(file, '{"current":true}');
  fs.writeFileSync(path.join(dir, 'settings.json.bak'), '{"old":true}');
  fs.writeFileSync(path.join(dir, 'settings.json.bak.day-2026-11-11'), '{"old":"day"}');
  fs.writeFileSync(path.join(dir, 'settings.json.bak.day-2026-11-12'), '{"old":"day2"}');
  fs.writeFileSync(path.join(dir, 'settings.json.bak.day-old'), 'keep');
  const n = reset.rewriteBackups(file, data);
  assert.equal(n, 3, 'две суточные и одна .bak');
  const json = JSON.stringify(data, null, 2);
  for (const f of ['settings.json.bak', 'settings.json.bak.day-2026-11-11', 'settings.json.bak.day-2026-11-12']) {
    assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), json, 'переписана ' + f);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json.bak.day-old'), 'utf8'), 'keep', 'чужое имя не трогаем');
});

test('сброс лицензии: ровно лицензия и ключ, защита часов цела', () => {
  const data = {
    modLicenses: { 'streamer-pack': [tok({ kind: 'full' })] },
    modLicenseKey: 'TPR-OLD',
    'modSecure.streamer-pack.core.licenseKey': 'enc-key',
    'modSecure.streamer-pack.bot.token': 'enc-token',
    licClockMax: 12345,
    savedLists: [{ title: 'x' }]
  };
  const r = reset.resetLicense(data);
  assert.equal(r.modLicenses, undefined);
  assert.equal(r.modLicenseKey, undefined);
  assert.equal(r['modSecure.streamer-pack.core.licenseKey'], undefined);
  assert.equal(r['modSecure.streamer-pack.bot.token'], 'enc-token');
  assert.equal(r.licClockMax, 12345);
  assert.deepEqual(r.savedLists, [{ title: 'x' }]);
});

test('сброс триала: только kind:trial, полные и защита часов целы', () => {
  const full = tok({ kind: 'full', pack: 'streamer-pack' });
  const trial = tok({ kind: 'trial', pack: 'streamer-pack' });
  const data = {
    modLicenses: { 'streamer-pack': [full, trial], other: [tok({ kind: 'trial' })] },
    licClockMax: 999,
    savedLists: [{ title: 'x' }]
  };
  const r = reset.resetTrial(data);
  assert.deepEqual(r.modLicenses, { 'streamer-pack': [full] });
  assert.equal(r.licClockMax, 999);
  assert.deepEqual(r.savedLists, [{ title: 'x' }]);
});

test('сброс триала не угадывает: непонятный токен остаётся', () => {
  const data = { modLicenses: { 'streamer-pack': ['garbage', tok({ kind: 'trial' }), tok({ kind: 'full' })] } };
  const r = reset.resetTrial(data);
  assert.equal(r.modLicenses['streamer-pack'].length, 2);
  assert.equal(r.modLicenses['streamer-pack'][0], 'garbage');
  assert.equal(reset.tokenKind('garbage'), '');
});

test('keepKey: список сохранения и границы префикса', () => {
  assert.equal(reset.keepKey('modSecure.streamer-pack.core.licenseKey'), true);
  assert.equal(reset.keepKey('modSecureX'), false);
  assert.equal(reset.keepKey('sbotSecure.key'), true);
  assert.equal(reset.keepKey('sbotSecure.password'), true);
  assert.equal(reset.keepKey('sbotSecureX'), false);
  assert.equal(reset.keepKey('savedLists'), true);
  assert.equal(reset.keepKey('savedListsX'), false);
  assert.equal(reset.keepKey('theme'), true);
  assert.equal(reset.keepKey('themeBar'), true);
  assert.equal(reset.keepKey('themes'), true);
  assert.equal(reset.keepKey('themeX'), false);
});
