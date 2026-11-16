import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const report = require('../../src/debug-report.js');
// Проверяем именно тот список, которым пользуются инструменты (обёртка над src/secret-patterns.js).
const { SECRET_PATTERNS, redact } = await import('../../tools/secret-patterns.mjs');

// Приманки собираем из кусков: иначе сам файл теста попадёт под проверку репозитория на ключи.
const D = {
  googleSecret: ['GOCS', 'PX-', 'abcDEF1234567890'].join(''),
  googleId: ['123456789012', '-', 'abcdefghijklmnop', '.apps.', 'googleusercontent.com'].join(''),
  githubPat: ['github', '_pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'].join(''),
  githubToken: ['gh', 'p_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'].join(''),
  googleApi: ['AIz', 'a', 'SyA1234567890abcdefghijklmnopqrstu'].join(''),
  yandex0: ['y', '0_', 'AgAAAAabcdefghijklmnopqrstuv'].join(''),
  yandexAq: ['AQ', 'AAAA', 'abcdefghijklmnopqrstuvwxyz'].join(''),
  hexKey: ['api_', 'key = ', '0123456789abcdef0123456789abcdef'].join(''),
  clientSecret: ['client_', 'secret: ', 'AbCdEf0123456789AbCdEf0123456789AbCdEf01'].join('')
};
D.all = [D.googleSecret, D.googleId, D.githubPat, D.githubToken, D.googleApi, D.yandex0, D.yandexAq, D.hexKey, D.clientSecret].join(' | ');

const settings = {
  savedLists: [{ id: 'l1', name: 'Кукушка', tracks: [{ artist: 'Кино', title: 'Кукушка' }] }],
  site: { about: 'Заказ: Вася — Кино — Кукушка', note: D.all },
  hotkeys: { playPause: 'Ctrl+Alt+P' },
  ordinary: 'оставить как есть',
  nested: { deeper: { token: 'nested-token-value' }, keep: 'ok' },
  modSecure: { 'streamer-pack': { core: { licenseKey: 'TPR-SECRET-INTERNAL' } } },
  modLicenseKey: 'TPR-AAAA-BBBB-CCCC',
  modLicenses: { 'streamer-pack': ['tpl1.secret-token-value'] },
  ymToken: 'ym-token-value',
  ytCookies: 'yt-cookies-value',
  ytOauth: 'yt-oauth-value',
  ytOauthAccount: { name: 'Иван', photo: 'https://example.invalid/a.png' },
  donKeys: { da: 'da-key-value' },
  ghToken: 'gh-token-value',
  someApiKey: 'some-api-key-value',
  clientSecret: 'client-secret-value',
  password: 'pass-secret-value',
  sapisid: 'sapisid-secret-value',
  authToken: 'auth-secret-value'
};

const state = {
  version: '0.34.0',
  build: 'dev',
  buildText: 'отладочная (dev)',
  commit: 'abc1234',
  channel: 'stable',
  channelText: 'стабильная',
  license: 'пробная до 12.12',
  pack: 'установлен, 0.3.0',
  modules: { bot: true, overlay: false },
  logins: { youtube: true, yandex: false, donationalerts: true, donatepay: false, twitch: true, lastfm: false, github: true },
  autofix: { youtube: 0, yandex: 0, donationalerts: 0, donatepay: 0, twitch: 0, lastfm: 0, github: 0 },
  dataDir: 'C:\\Users\\tester\\AppData\\Roaming\\Тапёр',
  load: {
    watch: true,
    current: { mem: 180, cpu: 3.5, at: 1762949000000 },
    peaks: { mem: 240, memAt: 1762949100000, cpu: 9.2, cpuAt: 1762949200000 }
  },
  verbose: false
};

const log = [
  '2026-11-12T14:00:00.000Z  заказы: Вася — Кино — Кукушка',
  '2026-11-12T14:00:01.000Z  поток: старт id=abc',
  '2026-11-12T14:00:02.000Z  путь: C:\\Users\\tester\\AppData\\Roaming\\Тапёр\\log.txt',
  '2026-11-12T14:00:03.000Z  приманка: ' + D.googleSecret
].join('\n');

test('отчёт: ни одного совпадения с шаблонами секретов', () => {
  const text = report.buildReport({ log: log, state: state, settings: settings, now: new Date('2026-11-12T14:05:00') });
  for (const p of SECRET_PATTERNS) {
    const re = new RegExp(p[0].source, p[0].flags);
    const found = [...text.matchAll(re)].map((m) => m[0]);
    assert.deepEqual(found, [], 'шаблон нашёл: ' + found.join(' | '));
  }
  assert.ok(text.includes('[скрыто]'), 'совпадения должны заменяться на [скрыто]');
});

// Приманки A4 собираем из кусков: иначе сам файл теста попадёт под проверку репозитория на ключи.
const A4 = {
  setCookie: ['set', '-cookie: '].join(''),
  auth: ['Author', 'ization: '].join(''),
  cookie: ['coo', 'kie: sid='].join(''),
  sess: ['_gh', '_sess=', 'abcdef', '1234567890'].join(''),
  google: ['ya', '29.', 'a0AfH6SMBexample-token-value'].join(''),
  gh: ['gh', 'o_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'].join(''),
  bearer: ['Bear', 'er '].join(''),
  sid: ['secret', '-cookie-value'].join(''),
};

test('A4: заголовки Cookie/Set-Cookie/Authorization вырезаются целиком', () => {
  const nasty = [
    '2026-11-12T14:00:00.000Z  ' + A4.setCookie + A4.sess + '; Path=/; HttpOnly',
    '2026-11-12T14:00:01.000Z  ' + A4.auth + A4.bearer + A4.google,
    '2026-11-12T14:00:02.000Z  {"headers":{"' + A4.auth.split(': ')[0].toLowerCase() + '":"' + A4.bearer + A4.gh + '"}}',
    '2026-11-12T14:00:03.000Z  ' + A4.cookie + A4.sid,
    '2026-11-12T14:00:04.000Z  обычная строка: заказ «Кино — Кукушка» остаётся',
  ].join('\n');
  const text = report.buildReport({ log: nasty, state: {}, settings: {}, now: new Date('2026-11-12T14:05:00') });
  for (const bad of [A4.sess, A4.google, A4.gh, A4.bearer.trim(), A4.setCookie.trim(), A4.auth.trim(), 'HttpOnly', A4.sid]) {
    assert.ok(!text.includes(bad), 'в отчёт попало: ' + bad);
  }
  assert.ok(text.includes('[скрыто]'), 'на месте заголовков — пометка');
  assert.ok(text.includes('Кино — Кукушка'), 'обычные строки журнала не тронуты');

  // Те же токены — и в самих шаблонах (ими пользуются scan-secrets и public-export).
  const line = A4.auth + A4.bearer + A4.google + '\n' + A4.setCookie + A4.sess + '\n' + A4.gh;
  const out = redact(line);
  for (const bad of [A4.google, A4.gh, A4.sess, A4.bearer.trim()]) assert.ok(!out.includes(bad), 'шаблон не скрыл: ' + bad);
});

test('A4: код вида Authorization: Bearer + token шаблон не принимает за ключ', () => {
  // В исходниках так строят заголовок; в отчёте это не токен. Шаблон должен молчать,
  // иначе scan-secrets и public-export будут ругаться на каждую строку кода.
  const code = "headers: { Authorization: 'Bearer ' + token }";
  assert.equal(redact(code), code);
  assert.equal(report.scrubSecrets(code), code);
  // В отчёте такая строка всё равно вырезается целиком: там заголовок, а не код.
  assert.ok(!report.scrubHeaders(code).includes('Bearer'));
  // Документация с многоточием — это не cookie, шаблон не должен валить scan-secrets.
  const doc = 'токены `gho_…`, `_gh_sess=…` (это пример, не значение)';
  assert.equal(redact(doc), doc);
});

test('отчёт: значений-приманок нет ни в настройках, ни в журнале', () => {
  const text = report.buildReport({ log: log, state: state, settings: settings, now: new Date('2026-11-12T14:05:00') });
  Object.keys(D).filter((k) => k !== 'all').forEach((k) => {
    assert.ok(!text.includes(D[k]), 'в отчёт попало значение ' + k);
  });
  ['modSecure', 'modLicenseKey', 'modLicenses', 'ymToken', 'ytCookies', 'ytOauth', 'donKeys', 'ghToken',
    'someApiKey', 'clientSecret', 'password', 'sapisid', 'authToken', 'nested-token-value',
    'yt-cookies-value', 'da-key-value', 'gh-token-value', 'client-secret-value'].forEach((s) => {
    assert.ok(!text.includes(s), 'в отчёт попало поле/значение ' + s);
  });
});

test('отчёт: ники и тексты заказов остаются как есть, обычные настройки тоже', () => {
  const text = report.buildReport({ log: log, state: state, settings: settings, now: new Date('2026-11-12T14:05:00') });
  assert.ok(text.includes('Вася — Кино — Кукушка'));
  assert.ok(text.includes('Кукушка'));
  assert.ok(text.includes('"playPause"'));
  assert.ok(text.includes('Ctrl+Alt+P'));
  assert.ok(text.includes('оставить как есть'));
  assert.ok(text.includes('"keep": "ok"'));
});

test('отчёт: путь пользователя сокращён, разделы на месте', () => {
  const text = report.buildReport({ log: log, state: state, settings: settings, now: new Date('2026-11-12T14:05:00') });
  assert.ok(text.includes('C:\\Users\\…'));
  assert.ok(!text.includes('Иван'), 'имя из настроек в отчёт не попадает');
  assert.ok(!text.includes('tester'), 'имя из пути в отчёт не попадает');
  assert.ok(text.includes('## Состояние'));
  assert.ok(text.includes('## Настройки'));
  assert.ok(text.includes('## Журнал'));
  assert.ok(text.includes('Версия: 0.34.0'));
  assert.ok(text.includes('Сборка: отладочная (dev)'));
});

test('отчёт: путь в настройках (JSON с удвоенными слэшами) тоже сокращён', () => {
  // Настройки печатаются через JSON.stringify, поэтому путь выглядит как C:\\Users\\user\\AppData.
  // A6: абсолютный путь целиком заменяется на <путь>, имя пользователя не попадает.
  const withPath = { ...settings, nowPlayingPath: 'C:\\Users\\tester\\Music\\now_playing.txt' };
  const text = report.buildReport({ log: log, state: state, settings: withPath, now: new Date('2026-11-12T14:05:00') });
  assert.ok(!text.includes('tester'), 'имя пользователя не должно попадать в отчёт');
  assert.ok(text.includes('"nowPlayingPath": "<путь>"'), 'значение-путь заменено на <путь>');
  assert.ok(!text.includes('now_playing.txt'));
  // Обычный (не JSON) вид по-прежнему сокращается.
  assert.equal(report.scrubUserPaths('C:\\Users\\tester\\AppData'), 'C:\\Users\\…\\AppData');
  assert.equal(report.scrubUserPaths('C:\\\\Users\\\\tester\\\\AppData'), 'C:\\\\Users\\\\…\\\\AppData');
});

test('A6: из настроек убраны поля path/folder/file/dir, пути в тексте скрыты', () => {
  const s = {
    savedLists: [{
      src: 'tap', title: 'Моё',
      tracks: [{ artist: 'A', title: 'B', path: 'D:\\Music\\Личное\\track.flac', folder: 'D:\\Music\\Личное', file: 'track.flac', dir: 'D:\\Music\\Личное' }],
    }],
    library: [{ title: 'C', path: 'D:\\Music\\Личное\\c.flac', folder: 'D:\\Music' }],
    note: 'Файл лежит в D:\\Music\\Личное\\x.txt',
    keep: 'оставить как есть',
  };
  const text = report.buildReport({ log: '', state: {}, settings: s, now: new Date('2026-11-12T14:05:00') });
  for (const bad of ['Личное', 'track.flac', 'c.flac', 'D:\\Music', '"path"', '"folder"', '"file"', '"dir"']) {
    assert.ok(!text.includes(bad), 'в отчёт попало: ' + bad);
  }
  assert.ok(text.includes('"note": "Файл лежит в <путь>"'), 'путь внутри текста заменён');
  assert.ok(text.includes('оставить как есть'), 'обычный текст не тронут');
});

test('A6: папка данных в «Состоянии» остаётся сокращённой, а не <путь>', () => {
  const st = { version: '0.34.0', dataDir: 'C:\\Users\\John Doe\\AppData\\Roaming\\Тапёр' }; // export-scan:allow — выдуманное имя с пробелом в образце
  const text = report.buildReport({ log: '', state: st, settings: {}, now: new Date('2026-11-12T14:05:00') });
  assert.ok(text.includes('C:\\Users\\…\\AppData\\Roaming\\Тапёр'), 'папка данных видна и сокращена');
  assert.ok(!text.includes('John Doe'), 'имя с пробелом скрыто');
  assert.ok(!text.includes('<путь>'), 'папку данных не заменяем на <путь>');
});

test('A6: в журнале абсолютные пути Windows и UNC заменяются на <путь>', () => {
  const nastyLog = 'D:\\Music\\Личное\\track.flac\n\\\\server\\share\\secret\\file.txt\nC:\\Users\\John Doe\\AppData'; // export-scan:allow — выдуманные пути в образце
  const text = report.buildReport({ log: nastyLog, state: {}, settings: {}, now: new Date('2026-11-12T14:05:00') });
  assert.ok(text.includes('<путь>'));
  for (const bad of ['Личное', 'server', 'share', 'John Doe', 'C:\\Users']) assert.ok(!text.includes(bad), 'в отчёт попало: ' + bad);
});

test('поля с именами секретов распознаются, hotkeys — нет', () => {
  assert.equal(report.isSecretField('modSecure.streamer-pack.core.licenseKey'), true);
  assert.equal(report.isSecretField('sbotSecure.key'), true);
  assert.equal(report.isSecretField('sbotSecure.password'), true);
  assert.equal(report.isSecretField('sbotSecure'), true);
  assert.equal(report.isSecretField('sbotHost'), false);
  assert.equal(report.isSecretField('modLicenseKey'), true);
  assert.equal(report.isSecretField('modLicenses'), true);
  assert.equal(report.isSecretField('ymToken'), true);
  assert.equal(report.isSecretField('ytCookies'), true);
  assert.equal(report.isSecretField('ytUseCookies'), true);
  assert.equal(report.isSecretField('ytOauth'), true);
  assert.equal(report.isSecretField('donKeys'), true);
  assert.equal(report.isSecretField('someApiKey'), true);
  assert.equal(report.isSecretField('clientSecret'), true);
  assert.equal(report.isSecretField('sapisidHash'), true);
  assert.equal(report.isSecretField('hotkeys'), false);
  assert.equal(report.isSecretField('perfWatch'), false);
  assert.equal(report.isSecretField('savedLists'), false);
  // A6: поля-пути убираются целиком, но не любой ключ со словом «путь».
  assert.equal(report.isPathField('path'), true);
  assert.equal(report.isPathField('Folder'), true);
  assert.equal(report.isPathField('file'), true);
  assert.equal(report.isPathField('dir'), true);
  assert.equal(report.isPathField('directory'), false);
  assert.equal(report.isPathField('nowPlayingPath'), false);
});
