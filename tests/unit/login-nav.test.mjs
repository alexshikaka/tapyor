// B7b (P5c №7): окна входа Яндекс и Google. Сторонняя страница в модальном окне программы —
// это фишинг, а токен Яндекса нельзя брать из адреса любого хоста. Правила:
//  - переходы внутри окна — только https;
//  - новые окна — только https и только хосты своего провайдера;
//  - access_token Яндекса — только с https-адреса Яндекса и decodeURIComponent в try.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LN = require('../../src/login-nav.js');

test('login-nav: переходы внутри окна входа — только https', () => {
  assert.equal(LN.navAllowed('https://passport.yandex.ru/auth'), true);
  assert.equal(LN.navAllowed('https://accounts.google.com/x'), true);
  assert.equal(LN.navAllowed('http://passport.yandex.ru/auth'), false);
  assert.equal(LN.navAllowed('javascript:alert(1)'), false);
  assert.equal(LN.navAllowed('file:///C:/Windows/notepad.exe'), false); // export-scan:allow — выдуманный образец
  assert.equal(LN.navAllowed(''), false);
  assert.equal(LN.navAllowed(null), false);
});

test('login-nav: новое окно Яндекса — только https-хосты Яндекса', () => {
  for (const u of [
    'https://oauth.yandex.ru/authorize',
    'https://passport.yandex.ru/auth',
    'https://yandex.ru/',
    'https://ya.ru/',
    'https://music.yandex.com/',
    'https://passport.yandex.by/',
    'https://oauth.yandex.com.tr/',
  ]) assert.equal(LN.yandexOpenAllowed(u), true, u);
  for (const u of [
    'http://passport.yandex.ru/auth',
    'https://evil.example/',
    'https://yandex.ru.evil.example/',
    'https://evil.example/?yandex.ru',
    'https://notyandex.ru/',
    'javascript:alert(1)',
    '',
    null,
  ]) assert.equal(LN.yandexOpenAllowed(u), false, String(u));
});

test('login-nav: новое окно Google — только https-хосты Google/YouTube', () => {
  for (const u of [
    'https://accounts.google.com/ServiceLogin',
    'https://consent.google.com/',
    'https://www.youtube.com/',
    'https://m.youtube.com/',
    'https://youtu.be/x',
    'https://accounts.googleusercontent.com/',
  ]) assert.equal(LN.googleOpenAllowed(u), true, u);
  for (const u of [
    'http://accounts.google.com/',
    'https://evil.example/',
    'https://google.com.evil.example/',
    'https://evil.example/?google.com',
    'https://notgoogle.com/',
    'javascript:alert(1)',
    '',
    null,
  ]) assert.equal(LN.googleOpenAllowed(u), false, String(u));
});

test('login-nav: токен Яндекса берём только с https-адреса Яндекса и не падаем на %', () => {
  assert.equal(LN.accessToken('https://music.yandex.ru/#access_token=ABC123'), 'ABC123');
  assert.equal(LN.accessToken('https://oauth.yandex.ru/verification_code#access_token=ABC&token_type=bearer'), 'ABC');
  assert.equal(LN.accessToken('https://passport.yandex.ru/?access_token=XYZ'), 'XYZ');
  assert.equal(LN.accessToken('https://evil.example/#access_token=ABC'), '', 'чужой хост');
  assert.equal(LN.accessToken('http://music.yandex.ru/#access_token=ABC'), '', 'не https');
  assert.equal(LN.accessToken('https://music.yandex.ru/#access_token=%'), '', 'битое кодирование — без исключения');
  assert.equal(LN.accessToken('https://music.yandex.ru/#access_token=%E0%A4%A'), '', 'битое кодирование — без исключения');
  assert.equal(LN.accessToken('https://music.yandex.ru/'), '');
  assert.equal(LN.accessToken(''), '');
  assert.equal(LN.accessToken(null), '');
});
