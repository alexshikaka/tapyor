// T1: тесты importers.js — разбор списков песен из текста, YouTube, Telegram,
// CSV, Spotify, Deezer, Apple Music и открытого канала Telegram. Только чистый разбор.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const I = require('../../src/importers.js');

const lines = (items) => items.map((x) => x.line).filter(Boolean);
const urls = (items) => items.map((x) => x.url).filter(Boolean);

// ---------- songish / fmtSec / tsSec ----------

test('importers.songish: обычные строки — песни, служебные и мусор — нет', () => {
  assert.equal(I.songish('Кино — Группа крови'), true);
  assert.equal(I.songish('Song 42'), true);
  assert.equal(I.songish(''), false);
  assert.equal(I.songish('ab'), false, 'короче трёх символов');
  assert.equal(I.songish('а'.repeat(161)), false, 'длиннее 160 символов');
  assert.equal(I.songish('Подписывайтесь на канал'), false);
  assert.equal(I.songish('https://youtu.be/x'), false);
  assert.equal(I.songish('1. Intro'), false);
  assert.equal(I.songish('Треклист:'), false);
  assert.equal(I.songish('!!!'), false, 'без букв и цифр');
});

test('importers.fmtSec и tsSec: секунды в «м:сс» и обратно, мусор — 0', () => {
  assert.equal(I.fmtSec(0), '0:00');
  assert.equal(I.fmtSec(59), '0:59');
  assert.equal(I.fmtSec(60), '1:00');
  assert.equal(I.fmtSec(3599), '59:59');
  assert.equal(I.fmtSec(3600), '60:00');
  assert.equal(I.tsSec('0:00'), 0);
  assert.equal(I.tsSec('1:30'), 90);
  assert.equal(I.tsSec('01:02:03'), 3723);
  assert.equal(I.tsSec('abc'), 0);
});

// ---------- fromText ----------

test('importers.fromText: строки песен и ссылки разделяются', () => {
  const r = I.fromText([
    'Кино — Группа крови',
    'https://music.yandex.ru/album/1/track/2',
    'Слушай https://youtu.be/abc',
    '',
  ].join('\n'));
  assert.deepEqual(lines(r.items), ['Кино — Группа крови']);
  assert.equal(urls(r.items).length, 2);
  assert.equal(urls(r.items)[0], 'https://music.yandex.ru/album/1/track/2');
});

// fromText пропускает служебные строки через songish, если в файле есть строки
// с разделителем «исполнитель — название»; без разделителей поведение прежнее.
test('importers.fromText: служебные строки не должны становиться песнями',
  () => {
    const r = I.fromText('Кино — Группа крови\nПодписывайтесь на канал');
    assert.deepEqual(lines(r.items), ['Кино — Группа крови']);
  });

test('importers.fromText: знаки после ссылки не попадают в адрес', () => {
  const r = I.fromText('Кино — https://youtu.be/abc),');
  assert.deepEqual(urls(r.items), ['https://youtu.be/abc']);
});

test('importers.fromText: пустое и мусор не бросают', () => {
  for (const v of ['', null, undefined, '   ', '!!!\n???']) {
    const r = I.fromText(v);
    assert.ok(Array.isArray(r.items));
  }
});

// ---------- fromYoutubeInfo ----------

test('importers.fromYoutubeInfo: главы важнее описания, intro/outro пропускаются', () => {
  const r = I.fromYoutubeInfo({
    title: 'Микс', duration: 300,
    chapters: [
      { title: 'Intro', start_time: 0, end_time: 10 },
      { title: 'Кино — Группа крови', start_time: 10, end_time: 130 },
      { title: 'Ария — Беспечный ангел', start_time: 130, end_time: 300 },
    ],
  });
  assert.equal(r.kind, 'chapters');
  assert.equal(r.title, 'Микс');
  assert.deepEqual(lines(r.items), ['Кино — Группа крови', 'Ария — Беспечный ангел']);
  assert.equal(r.items[0].seconds, 120);
  assert.equal(r.items[0].at, 10);
});

test('importers.fromYoutubeInfo: таймкоды в описании — секунды до следующего', () => {
  const r = I.fromYoutubeInfo({
    title: 'Видео', duration: 300,
    description: '0:00 Кино — Группа крови\n2:10 Ария — Беспечный ангел\n',
  });
  assert.equal(r.kind, 'timestamps');
  assert.deepEqual(lines(r.items), ['Кино — Группа крови', 'Ария — Беспечный ангел']);
  assert.equal(r.items[0].seconds, 130);
  assert.equal(r.items[1].seconds, 170);
});

test('importers.fromYoutubeInfo: нумерованный список с тире и список с тире', () => {
  const num = I.fromYoutubeInfo({ description: '1. Кино — Группа крови\n2. Ария — Беспечный ангел' });
  assert.equal(num.kind, 'list');
  assert.equal(num.items.length, 2);

  const dash = I.fromYoutubeInfo({ description: 'Кино — Группа крови\nАрия — Беспечный ангел\nЗемфира — Искала' });
  assert.equal(dash.kind, 'list');
  assert.equal(dash.items.length, 3);
});

test('importers.fromYoutubeInfo: нет глав и списка — kind none и понятная пометка', () => {
  const r = I.fromYoutubeInfo({ description: 'просто текст без песен' });
  assert.equal(r.kind, 'none');
  assert.deepEqual(r.items, []);
  assert.ok(r.note);
  assert.equal(r.title, 'Видео YouTube');
});

test('importers.fromYoutubeInfo: пустой объект не бросает', () => {
  const r = I.fromYoutubeInfo({});
  assert.equal(r.kind, 'none');
  assert.deepEqual(r.items, []);
});

// ---------- fromTelegramJson ----------

test('importers.fromTelegramJson: аудио, ссылки и строки «исполнитель — название»', () => {
  const r = I.fromTelegramJson(JSON.stringify({
    name: 'Чат',
    messages: [
      { type: 'message', media_type: 'audio_file', performer: 'Кино', title: 'Группа крови', duration_seconds: 210 },
      { type: 'message', text: ['Слушай ', { href: 'https://youtu.be/x' }] },
      { type: 'message', text: 'Ария — Беспечный ангел' },
      { type: 'service', text: 'Кино — Не должно попасть' },
    ],
  }));
  assert.equal(r.title, 'Чат');
  assert.deepEqual(lines(r.items), ['Кино — Группа крови', 'Ария — Беспечный ангел']);
  assert.equal(r.items[0].seconds, 210);
  assert.deepEqual(urls(r.items), ['https://youtu.be/x']);
});

test('importers.fromTelegramJson: BOM и вложенные чаты читаются', () => {
  const text = '\uFEFF' + JSON.stringify({ chats: { list: [{ messages: [{ type: 'message', text: 'Кино — Группа крови' }] }] } });
  const r = I.fromTelegramJson(text);
  assert.deepEqual(lines(r.items), ['Кино — Группа крови']);
});

test('importers.fromTelegramJson: битый JSON и не-список сообщений — null', () => {
  assert.equal(I.fromTelegramJson('{битый'), null);
  assert.equal(I.fromTelegramJson(JSON.stringify({ messages: {} })), null);
});

// Файл JSON, который не является объектом (null, число, список), — не экспорт
// Telegram: fromTelegramJson возвращает null, а вызывающий показывает понятную ошибку.
test('importers.fromTelegramJson: файл «null» не должен ронять импорт',
  () => {
    assert.equal(I.fromTelegramJson('null'), null);
  });

// ---------- fromTelegramHtml ----------

test('importers.fromTelegramHtml: заголовок, аудио, ссылка и строка с тире', () => {
  const html = [
    '<div class="text bold">Мой чат</div>',
    '<div class="media clearfix pull_left media_audio_file"><div class="title bold">Группа крови</div><div class="status details">Кино</div></div>',
    '<div class="text">Слушай <a href="https://youtu.be/x">тут</a><br>Ария — Беспечный ангел</div>',
  ].join('\n');
  const r = I.fromTelegramHtml(html);
  assert.equal(r.title, 'Мой чат');
  assert.deepEqual(lines(r.items), ['Кино — Группа крови', 'Ария — Беспечный ангел']);
  assert.deepEqual(urls(r.items), ['https://youtu.be/x']);
});

test('importers.fromTelegramHtml: без заголовка — «Из Telegram», мусор не бросает', () => {
  assert.equal(I.fromTelegramHtml('').title, 'Из Telegram');
  assert.equal(I.fromTelegramHtml(null).items.length, 0);
});

// ---------- fromCsv ----------

test('importers.fromCsv: запятая, кавычки с запятой внутри, длительность «м:сс»', () => {
  const r = I.fromCsv('title,artist,duration\n"Группа, крови",Кино,3:30\n');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].line, 'Кино — Группа, крови');
  assert.equal(r.items[0].seconds, 210);
});

test('importers.fromCsv: точка с запятой, табуляция, BOM и миллисекунды', () => {
  const semi = I.fromCsv('\uFEFFИсполнитель;Название;Длительность\nКино;Группа крови;210000');
  assert.equal(semi.items[0].line, 'Кино — Группа крови');
  assert.equal(semi.items[0].seconds, 210);

  const tab = I.fromCsv('Track Name\tArtist Name\nГруппа крови\tКино');
  assert.equal(tab.items[0].line, 'Кино — Группа крови');
});

test('importers.fromCsv: без колонки названия или без строк — null', () => {
  assert.equal(I.fromCsv('artist,album\nКино,Лучшее'), null);
  assert.equal(I.fromCsv('title\n'), null);
  assert.equal(I.fromCsv(''), null);
});

test('importers.fromCsv: альбом сохраняется, пустые строки пропускаются', () => {
  const r = I.fromCsv('title,artist,album\nГруппа крови,Кино,Лучшее\n,,');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].album, 'Лучшее');
});

// ---------- fromSpotifyEmbed ----------

test('importers.fromSpotifyEmbed: список треков из __NEXT_DATA__', () => {
  const entity = {
    name: 'Мой плейлист',
    trackList: [{ title: 'Группа крови', subtitle: 'Кино', duration: 210000 }],
  };
  const html = '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) + '</script>';
  const r = I.fromSpotifyEmbed(html);
  assert.equal(r.title, 'Мой плейлист');
  assert.equal(r.items[0].line, 'Кино — Группа крови');
  assert.equal(r.items[0].seconds, 210);
});

test('importers.fromSpotifyEmbed: один трек и отсутствие данных', () => {
  const entity = { type: 'track', name: 'Песня', artists: [{ name: 'Кто-то' }], duration: 180000 };
  const html = '<script id="__NEXT_DATA__">' +
    JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) + '</script>';
  assert.equal(I.fromSpotifyEmbed(html).items[0].line, 'Кто-то — Песня');
  assert.equal(I.fromSpotifyEmbed(''), null);
  assert.equal(I.fromSpotifyEmbed('<script id="__NEXT_DATA__">{битый</script>'), null);
});

// ---------- fromDeezerJson ----------

test('importers.fromDeezerJson: tracks.data и data, название и длительность', () => {
  const a = I.fromDeezerJson({ title: 'Плейлист', tracks: { data: [{ title: 'Группа крови', artist: { name: 'Кино' }, duration: 210 }] } });
  assert.equal(a.title, 'Плейлист');
  assert.equal(a.items[0].line, 'Кино — Группа крови');
  assert.equal(a.items[0].seconds, 210);

  const b = I.fromDeezerJson({ data: [{ title: 'Песня' }] });
  assert.equal(b.items[0].line, 'Песня');
  assert.equal(b.title, 'Плейлист Deezer');
});

test('importers.fromDeezerJson: пусто и null — пустой список, без исключения', () => {
  assert.deepEqual(I.fromDeezerJson(null).items, []);
  assert.deepEqual(I.fromDeezerJson({}).items, []);
});

// ---------- fromAppleHtml ----------

test('importers.fromAppleHtml: serialized-server-data, обложка-заголовок и повторы', () => {
  const data = { data: [{ title: 'Группа крови', artistName: 'Кино', duration: 210000 }] };
  const html = '<meta property="og:title" content="Мой плейлист">' +
    '<script id="serialized-server-data" type="application/json">' + JSON.stringify(data) + '</script>' +
    '<script id="serialized-server-data" type="application/json">' + JSON.stringify(data) + '</script>';
  const r = I.fromAppleHtml(html);
  assert.equal(r.title, 'Мой плейлист');
  assert.equal(r.items.length, 1, 'повтор убран');
  assert.equal(r.items[0].line, 'Кино — Группа крови');
  assert.equal(r.items[0].seconds, 210);
});

test('importers.fromAppleHtml: запасной ld+json и пустая страница', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    track: { itemListElement: [{ item: { name: 'Группа крови', byArtist: [{ name: 'Кино' }] } }] },
  }) + '</script>';
  const r = I.fromAppleHtml(html);
  assert.equal(r.items[0].line, 'Кино — Группа крови');
  assert.equal(I.fromAppleHtml('').title, 'Плейлист Apple Music');
  assert.deepEqual(I.fromAppleHtml('').items, []);
});

// ---------- fromTmeChannel ----------

test('importers.fromTmeChannel: аудио, ссылка, строка с тире и самый старый пост', () => {
  const html = [
    '<meta property="og:title" content="Канал">',
    '<div class="tgme_widget_message_wrap" data-post="chan/10">',
    '<div class="tgme_widget_message_document_title">Группа крови</div>',
    '<div class="tgme_widget_message_document_extra">Кино · 3:30</div>',
    '<div class="tgme_widget_message_text">Слушай <a href="https://youtu.be/x">тут</a><br>Ария — Беспечный ангел</div>',
    '</div>',
    '<div class="tgme_widget_message_wrap" data-post="chan/9"></div>',
  ].join('');
  const r = I.fromTmeChannel(html);
  assert.equal(r.title, 'Канал');
  assert.equal(r.oldest, 9);
  assert.deepEqual(lines(r.items), ['Кино — Группа крови', 'Ария — Беспечный ангел']);
  assert.deepEqual(urls(r.items), ['https://youtu.be/x']);
});

test('importers.fromTmeChannel: пустая страница не бросает', () => {
  const r = I.fromTmeChannel(null);
  assert.equal(r.title, 'Канал Telegram');
  assert.deepEqual(r.items, []);
  assert.equal(r.oldest, 0);
});

// ---------- dedupeItems / MUSIC_LINK ----------

test('importers.dedupeItems: повторы с разным регистром, «ё» и знаками остаются одни', () => {
  const out = I.dedupeItems([
    { line: 'Кино — Группа крови' },
    { line: 'кино - группа крови' },
    { line: 'Кино — Всё идёт по плану' },
    { line: 'Кино — Все идет по плану' },
    { url: 'https://youtu.be/x' },
    { url: 'https://youtu.be/x' },
    { line: '' },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].line, 'Кино — Группа крови');
  assert.equal(out[2].url, 'https://youtu.be/x');
});

test('importers.dedupeItems: пустой список — пустой результат', () => {
  assert.deepEqual(I.dedupeItems([]), []);
});

test('importers.MUSIC_LINK: узнаёт ссылки музыкальных площадок и не трогает чужие', () => {
  const link = (s) => (s.match(I.MUSIC_LINK) || []).length;
  assert.equal(link('https://music.yandex.ru/album/1/track/2'), 1);
  assert.equal(link('https://youtu.be/abc'), 1);
  assert.equal(link('https://open.spotify.com/track/1'), 1);
  assert.equal(link('https://example.com/song'), 0);
});
