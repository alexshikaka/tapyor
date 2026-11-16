// T1: тесты sitepage.js — чистые части: сборка страницы стримера и QR-кода,
// проверка адресов, экранирование и статус без сети.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../src/sitepage.js');

function memoryStore(init) {
  const data = Object.assign({}, init || {});
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v; } };
}

// ---------- build ----------

test('sitepage.build: ник, описание, каналы, донаты и цена попадают на страницу', () => {
  const html = S.build({
    nick: 'Вася', about: 'Играю музыку', price: 199.6, currency: 'RUB',
    channels: { twitch: 'twitch.tv/vasya', youtube: 'https://youtube.com/@vasya' },
    donate: { da: 'https://donationalerts.com/r/vasya', boosty: 'boosty.to/vasya' },
    instr: 'Пиши `!sr исполнитель — песня`\nВторой строкой',
  });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Вася'));
  assert.ok(html.includes('Играю музыку'));
  assert.ok(html.includes('200 ₽'), 'цена округляется и получает знак валюты');
  assert.ok(html.includes('https://twitch.tv/vasya'), 'адрес без схемы получает https');
  assert.ok(html.includes('YouTube'));
  assert.ok(html.includes('DonationAlerts'));
  assert.ok(html.includes('Boosty'));
  assert.ok(html.includes('<code>!sr исполнитель — песня</code>'));
});

test('sitepage.build: пустая инструкция заменяется текстом владельца по умолчанию', () => {
  const html = S.build({});
  assert.ok(html.includes('Нажми любую кнопку доната выше.'));
  assert.ok(html.includes('Если хочешь заказать песню, в сообщении напиши песню:'));
  assert.ok(html.includes('<code>Исполнитель — Название</code>'));
  assert.ok(html.includes('(YouTube, Яндекс Музыка, SoundCloud)'));
  assert.ok(html.includes('Привет и пожелания пиши там же: песню программа найдёт сама.'));
});

test('sitepage.build: сохранённая инструкция не заменяется текстом по умолчанию', () => {
  const html = S.build({ instr: 'Мой текст заказа' });
  assert.ok(html.includes('Мой текст заказа'));
  assert.ok(!html.includes('Нажми любую кнопку доната выше.'));
});

test('sitepage.build: правила больше не выводятся, даже если остались в настройках', () => {
  const html = S.build({ rules: 'Не больше трёх заказов' });
  assert.ok(!html.includes('Не больше трёх заказов'));
  assert.ok(!html.includes('class="ru"'));
});

test('sitepage.build: у кнопок донатов свой цвет и логотип сервиса', () => {
  const html = S.build({ donate: {
    da: 'https://donationalerts.com/r/vasya', dp: 'https://donatepay.ru/x',
    boosty: 'https://boosty.to/vasya', other: 'https://example.com/donate'
  } });
  assert.ok(html.includes('--bc:#F4511E'));
  assert.ok(html.includes('--bc:#22C55E'));
  assert.ok(html.includes('--bc:#FF7A00'));
  // Хотфикс 0.36.3: у DonationAlerts и DonatePay — настоящий логотип (img, data: URI), а не буквы в кружке
  assert.ok(/<span class="svc logo"><img src="data:image\/png;base64,[^"]+" alt="DonationAlerts"><\/span>/.test(html));
  assert.ok(/<span class="svc logo"><img src="data:image\/png;base64,[^"]+" alt="DonatePay"><\/span>/.test(html));
  assert.ok(html.includes('<span class="svc">B</span>'), 'у Boosty логотипа нет — остались буквы');
  assert.ok(html.includes('border:1px solid var(--bc,var(--ac))'), 'обводка берёт цвет сервиса');
});

test('sitepage.build: чужие схемы адресов не превращаются в ссылки', () => {
  const html = S.build({
    nick: 'Вася',
    avatar: 'javascript:alert(1)',
    channels: { twitch: 'javascript:alert(1)', youtube: 'ftp://example.com/x' },
    donate: { da: 'data:text/html,<b>x</b>' },
  });
  assert.ok(!html.includes('javascript:'), 'javascript: не должен попасть на страницу');
  assert.ok(!html.includes('ftp://'), 'ftp: не должен попасть на страницу');
  assert.ok(!html.includes('<img'), 'плохой адрес аватара не становится картинкой');
});

test('sitepage.build: разметка в тексте экранируется, а не исполняется', () => {
  const html = S.build({
    nick: '<script>alert(1)</script>',
    about: '"><b>жирный</b>',
    instr: '<img src=x onerror=alert(1)>',
    qrCaption: '<b>Скан</b>',
    colors: { bg: 'red', card: '#123456', tx: '#GGGGGG', tx2: '#AABBCC', ac: '#8B7CF6', pri: '#8B7CF6' },
  });
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<b>жирный</b>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('--bg:#15161C'), 'неверный цвет заменяется запасным');
  assert.ok(html.includes('--card:#123456'));
  assert.ok(html.includes('--tx:#ECEDF2'), 'неверный текст заменяется запасным');
});

test('sitepage.build: пустые данные дают страницу с заглушками и без ссылок', () => {
  const html = S.build({});
  assert.ok(html.includes('Мой стрим'));
  assert.ok(html.includes('Ссылки на донат появятся здесь.'));
  assert.ok(!html.includes('за трек'), 'цены нет');
  assert.ok(!html.includes('<a href="undefined"'));
});

test('sitepage.build: выключенный показ цены скрывает её, даже если цена задана', () => {
  const off = S.build({ price: 100, currency: 'RUB', showPrice: false });
  assert.ok(!off.includes(' за трек'));
  const on = S.build({ price: 100, currency: 'RUB', showPrice: true });
  assert.ok(on.includes('100 ₽ за трек'));
  const byDefault = S.build({ price: 100, currency: 'RUB' });
  assert.ok(byDefault.includes('100 ₽ за трек'), 'без настройки цена показывается как раньше');
});

test('sitepage.build: нулевая, отрицательная и нечисловая цена не показывается', () => {
  for (const price of [0, -100, 'дорого', null, NaN]) {
    const html = S.build({ price, currency: 'USD' });
    assert.ok(!html.includes(' за трек'), 'цена ' + String(price));
  }
});

test('sitepage.build: неизвестная валюта показывается кодом, а не пустотой', () => {
  const html = S.build({ price: 100, currency: 'GBP' });
  assert.ok(html.includes('100 GBP'));
});

test('sitepage.build: очень длинные и юникодные строки не бросают', () => {
  const html = S.build({ nick: 'Ы'.repeat(500), about: '🎵'.repeat(300), instr: 'а'.repeat(2000) });
  assert.ok(html.includes('Ы'.repeat(500)));
});

// ---------- buildQr ----------

test('sitepage.buildQr: SVG встроен, без <?xml, подпись и цвет рамки на месте', () => {
  const html = S.buildQr({ colors: { pri: '#FF0000' }, qrCaption: 'Заказать песню' }, 'https://example.github.io/tapyor-page/');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<svg'));
  assert.ok(!html.includes('<?xml'));
  assert.ok(html.includes('border:4px solid #FF0000'));
  assert.ok(html.includes('Заказать песню'));
});

test('sitepage.buildQr: подпись экранируется, неверный цвет — запасной', () => {
  const html = S.buildQr({ colors: { pri: 'javascript:alert(1)' }, qrCaption: '<b>Скан</b>' }, 'https://example.com/');
  assert.ok(html.includes('&lt;b&gt;Скан&lt;/b&gt;'));
  assert.ok(html.includes('#8B7CF6'));
});

test('sitepage.buildQr: другой адрес — другой рисунок', () => {
  const a = S.buildQr({}, 'https://example.com/a');
  const b = S.buildQr({}, 'https://example.com/b');
  assert.notEqual(a, b);
});

// ---------- статус без сети ----------

test('sitepage.status: без сохранённого входа — не подключён и без адреса', () => {
  S.setup({ store: memoryStore() });
  const st = S.status();
  assert.equal(st.connected, false);
  assert.equal(st.url, '');
  assert.equal(st.configured, false, 'нет github-oauth.json в проверке');
});

test('sitepage.setToken(""): очищает вход без сети', async () => {
  const store = memoryStore({ ghToken: 'старое', ghAccount: { login: 'x' } });
  S.setup({ store });
  const r = await S.setToken('');
  assert.deepEqual(r, { ok: true });
  assert.equal(store.data.ghToken, null);
  assert.equal(store.data.ghAccount, null);
});

test('sitepage.publish: без входа — понятная ошибка, а не запрос в сеть', async () => {
  S.setup({ store: memoryStore() });
  const r = await S.publish({ nick: 'Вася' });
  assert.equal(r.error, 'сначала подключи GitHub');
});

test('sitepage.deviceStart: без настроенного приложения — not-configured', async () => {
  S.setup({ store: memoryStore() });
  assert.deepEqual(await S.deviceStart(), { error: 'not-configured' });
});

test('sitepage: наборы сервисов донатов и каналов на месте', () => {
  assert.deepEqual(S.SERVICES.map((x) => x.k), ['da', 'dp', 'boosty', 'other']);
  assert.deepEqual(S.CHANNELS.map((x) => x.k), ['twitch', 'youtube', 'vk', 'kick', 'telegram']);
});
