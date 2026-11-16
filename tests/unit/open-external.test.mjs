// 0.33.1: какие адреса Тапёр вообще открывает в браузере. Ошибка 0.33.0 была именно здесь:
// в списке не было github.com и t.me, и кнопки «О программе» молча ничего не делали.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { allowed } = require('../../src/open-external.js');

test('открываются ровно наши адреса: репозиторий, задачи, политика данных', () => {
  for (const u of [
    'https://github.com/alexshikaka/tapyor',
    'https://github.com/alexshikaka/tapyor/',
    'https://github.com/alexshikaka/tapyor/issues',
    'https://github.com/alexshikaka/tapyor/issues/new/choose',
    'https://github.com/alexshikaka/tapyor/issues/new/choose?labels=bug&title=%D0%9E%D1%88%D0%B8%D0%B1%D0%BA%D0%B0',
    'https://github.com/alexshikaka/tapyor/blob/main/PRIVACY.md'
  ]) assert.equal(allowed(u), true, u);
});

test('открываются Telegram-канал и чат', () => {
  for (const u of ['https://t.me/tapyor', 'https://t.me/tapyorchat', 'https://t.me/tapyor/123', 'https://t.me/tapyor?x=1']) {
    assert.equal(allowed(u), true, u);
  }
});

test('поддержка автора: DonationAlerts и ЮMoney открываются, похожие домены — нет', () => {
  for (const u of [
    'https://www.donationalerts.com/r/alexshikaka',
    'https://donationalerts.com/r/alexshikaka',
    'https://yoomoney.ru/to/410011529262377'
  ]) assert.equal(allowed(u), true, u);
  for (const u of [
    'https://donationalerts.com.evil.example/r/alexshikaka',
    'https://evil.example/donationalerts.com/r/alexshikaka',
    'https://yoomoney.ru.evil.example/to/410011529262377',
    'https://evil.example/?x=yoomoney.ru',
    'http://yoomoney.ru/to/410011529262377',
    'https://user:pass@yoomoney.ru/to/410011529262377',
    'https://donationalerts.com.evil.example/',
    'https://yoomoney.ru.evil.example/'
  ]) assert.equal(allowed(u), false, u);
});

test('музыкальные адреса открываются как раньше', () => {
  for (const u of [
    'https://yandex.ru/music',
    'https://music.yandex.ru/album/1',
    'https://youtube.com/watch?v=1',
    'https://youtu.be/abc',
    'https://soundcloud.com/a/b',
    'https://bandcamp.com/x',
    'https://audius.co/x'
  ]) assert.equal(allowed(u), true, u);
});

test('похожие и чужие адреса НЕ открываются', () => {
  for (const u of [
    'https://github.com/evil/tapyor',            // чужой владелец
    'https://github.com/alexshikaka/tapyor-evil', // другой репозиторий
    'https://github.com/alexshikaka/tapyorx',
    'https://t.me/tapyorchat2',                   // другой канал
    'https://t.me/other',
    'https://t.me/tapyor_evil',
    'http://t.me/tapyor',                         // не https
    'http://github.com/alexshikaka/tapyor',
    'https://evil.example/github.com/alexshikaka/tapyor',
    'javascript:alert(1)',
    'file:///tmp/calc.exe',
    '',
    null,
    undefined
  ]) assert.equal(allowed(u), false, String(u));
});

test('список не пустой и не «любой https»', () => {
  assert.ok(Array.isArray(require('../../src/open-external.js').RULES));
  assert.ok(require('../../src/open-external.js').RULES.length <= 6, 'правил немного — список точный');
});

// ── B5-1 (стабилизация 12.11): второй белый список — для open-link ───────────
// Раньше список жил регулярным выражением прямо в обработчике main.js, и правила были мягче
// (хост «содержит» имя). Здесь — точное совпадение хоста или поддомен, только https.
const { allowedLink, LINK_HOSTS, yandexDeviceUrl, githubDeviceUrl } = require('../../src/open-external.js');

// Набор хостов прежнего open-link без брошенных сервисов: ЮMoney и Donatello.
const LINK_EXPECTED = [
  'donationalerts.com', 'donatepay.ru', 'donatepay.eu', 'boosty.to',
  'github.com', 'github.io', 't.me', 'twitch.tv', 'youtube.com', 'youtu.be', 'vk.com',
  'vkvideo.ru', 'kick.com', 'music.yandex.ru', 'soundcloud.com', 'developers.sber.ru'
];

test('open-link: набор хостов сохранён, брошенные сервисы убраны', () => {
  assert.deepEqual([...LINK_HOSTS].sort(), LINK_EXPECTED.slice().sort());
  assert.ok(!LINK_HOSTS.includes('yoomoney.ru'));
  assert.ok(!LINK_HOSTS.includes('donatello.to'));
});

test('open-link: каждый хост списка проходит', () => {
  for (const h of LINK_EXPECTED) {
    assert.equal(allowedLink('https://' + h + '/'), true, h);
    assert.equal(allowedLink('https://' + h + '/page?x=1'), true, h + '/page');
  }
});

test('open-link: поддомен проходит, похожие имена — нет', () => {
  assert.equal(allowedLink('https://www.twitch.tv/'), true);
  assert.equal(allowedLink('https://music.youtube.com/watch?v=1'), true);
  assert.equal(allowedLink('https://github.com.evil.com/'), false);
  assert.equal(allowedLink('https://evil.com/?x=github.com'), false);
  assert.equal(allowedLink('https://notgithub.com/'), false);
  assert.equal(allowedLink('https://github.io.evil.com/'), false);
  assert.equal(allowedLink('https://yoomoney.ru/'), false);
  assert.equal(allowedLink('https://donatello.to/'), false);
});

test('open-link: только https, без user:pass@, длина ≤ 2000', () => {
  for (const u of ['http://github.com/', 'http://www.twitch.tv/', 'ftp://github.com/', 'javascript:alert(1)', 'file:///tmp/calc.exe']) {
    assert.equal(allowedLink(u), false, u);
  }
  assert.equal(allowedLink('https://user:pass@github.com/'), false);
  assert.equal(allowedLink('https://user@github.com/'), false);
  assert.equal(allowedLink('https://github.com/' + 'a'.repeat(2000)), false, 'длинный адрес');
  assert.equal(allowedLink('https://github.com/' + 'a'.repeat(1900)), true, 'обычный адрес');
  assert.equal(allowedLink(''), false);
  assert.equal(allowedLink(null), false);
  assert.equal(allowedLink(undefined), false);
});

// ── B5-2 (стабилизация 12.11): адреса из ответов серверов ────────────────────
// Яндекс (вход по коду) и GitHub (вход по коду) присылают адрес для браузера. Чужой адрес
// не открываем: берём известный запасной и пишем строку в журнал (это делает вызывающий код).
test('вход в Яндекс: только https и ya.ru / yandex.ru / yandex.com с поддоменами', () => {
  for (const u of ['https://ya.ru/device', 'https://oauth.yandex.ru/device', 'https://yandex.ru/device', 'https://yandex.com/device', 'https://id.yandex.com/device']) {
    assert.equal(yandexDeviceUrl(u), u, u);
  }
  for (const u of ['https://yandex.ru.evil.com/device', 'https://evil.com/?x=yandex.ru', 'http://ya.ru/device', 'https://user:pass@ya.ru/device', 'https://ya.ru.evil.com/', '', null, undefined]) {
    assert.equal(yandexDeviceUrl(u), 'https://ya.ru/device', String(u));
  }
});

test('вход в GitHub: только https://github.com/…', () => {
  for (const u of ['https://github.com/login/device', 'https://github.com/login/device?x=1']) {
    assert.equal(githubDeviceUrl(u), u, u);
  }
  for (const u of ['https://github.com.evil.com/login/device', 'https://evil.com/?x=github.com', 'http://github.com/login/device', 'https://gist.github.com/login/device', 'https://user:pass@github.com/login/device', '', null, undefined]) {
    assert.equal(githubDeviceUrl(u), 'https://github.com/login/device', String(u));
  }
});

test('покупка пака стримера: страница товара GGSel открывается, похожие адреса — нет', () => {
  for (const u of [
    'https://ggsel.net/catalog/product/104388863',
    'https://ggsel.net/catalog/product/104388863?lang=ru'
  ]) assert.equal(allowed(u), true, u);
  for (const u of [
    'http://ggsel.net/catalog/product/104388863',
    'https://ggsel.net.evil.example/catalog/product/104388863',
    'https://evil.ggsel.net/catalog/product/104388863',
    'https://ggsel.net/logout',
    'https://ggsel.net/catalog/product/104388863.evil',
    'https://evil.example/?x=ggsel.net/catalog/product/1'
  ]) assert.equal(allowed(u), false, u);
});
