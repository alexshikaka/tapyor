import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SBS = require('../../src/sbot-settings.js');

test('sbot-settings: умолчания — таблица 7.4 плана, «да/нет» пишутся как 1/0', () => {
  const d = SBS.defaultDraft();
  assert.deepEqual(d.tapyorCmdOrder, ['!sr', '!play']);
  assert.deepEqual(d.tapyorCmdSong, ['!song']);
  assert.equal(d.tapyorWho, 'all');
  assert.equal(d.tapyorFollowDays, 0);
  assert.equal(d.tapyorPerUser, 1);
  assert.equal(d.tapyorPauseMin, 30);
  assert.equal(d.tapyorChatCap, 10);
  assert.equal(d.tapyorDoubt, 'wait');
  assert.equal(d.tapyorReplyAs, 'broadcaster');
  assert.equal(d.tapyorReplyMode, 'reply');

  const v = SBS.toValues(d);
  assert.equal(v.tapyorCmdOrder, '!sr, !play');
  assert.equal(v.tapyorOnOrder, '1');
  assert.equal(v.tapyorVipFree, '1');
  assert.equal(v.tapyorPoints, '1');
  assert.equal(v.tapyorPauseReward, '1');
  assert.equal(v.tapyorWho, 'all');
  assert.equal(v.tapyorPauseMin, 30);
  for (const r of SBS.REPLY_DEFS) assert.equal(v[r.key], '', 'пусто = фраза Тапёра');
  // Порт отвечает статусом `limit` и на «уже ждёт», и на «очередь полна»; шаблон ищет текст
  // по статусу, поэтому отдельного «Очередь полна» в конструкторе нет (задание E6, п. 2.1).
  assert.equal(SBS.REPLY_DEFS.some((r) => r.key === 'tapyorTxtCap'), false);
  assert.equal(v.tapyorTxtCap, undefined);
});

test('sbot-settings: читает «да/нет», 1/0, true/false и числа из Streamer.bot', () => {
  const g = {
    tapyorCmdOrder: '!sr,!tsr, !play',
    tapyorOnOrder: 'да',
    tapyorOnSong: '0',
    tapyorOnPlace: 'true',
    tapyorOnCancel: 'False',
    tapyorOnSkip: 'нет',
    tapyorWho: 'Follower',
    tapyorFollowDays: '7',
    tapyorPerUser: '2',
    tapyorPauseMin: '15',
    tapyorChatCap: '25',
    tapyorVipFree: '1',
    tapyorDoubt: 'ask',
    tapyorPoints: '0',
    tapyorRewardName: '  Заказать трек  ',
    tapyorPauseReward: 'false',
    tapyorReplyAs: 'bot',
    tapyorReplyMode: 'msg',
    tapyorTxtQueued: '@{user}, {track} — {place}-й',
    tapyorUrl: 'http://127.0.0.1:47654',
    tapyorKey: 'tp_secret',
  };
  const d = SBS.fromGlobals(g);
  assert.deepEqual(d.tapyorCmdOrder, ['!sr', '!tsr', '!play']);
  assert.equal(d.tapyorOnOrder, true);
  assert.equal(d.tapyorOnSong, false);
  assert.equal(d.tapyorOnPlace, true);
  assert.equal(d.tapyorOnCancel, false);
  assert.equal(d.tapyorOnSkip, false);
  assert.equal(d.tapyorWho, 'follower');
  assert.equal(d.tapyorFollowDays, 7);
  assert.equal(d.tapyorPerUser, 2);
  assert.equal(d.tapyorPauseMin, 15);
  assert.equal(d.tapyorChatCap, 25);
  assert.equal(d.tapyorVipFree, true);
  assert.equal(d.tapyorDoubt, 'ask');
  assert.equal(d.tapyorPoints, false);
  assert.equal(d.tapyorRewardName, 'Заказать трек');
  assert.equal(d.tapyorPauseReward, false);
  assert.equal(d.tapyorReplyAs, 'bot');
  assert.equal(d.tapyorReplyMode, 'msg');
  assert.equal(d.tapyorTxtQueued, '@{user}, {track} — {place}-й');
  assert.equal('tapyorUrl' in d, false, 'адрес порта конструктор не трогает');
  assert.equal('tapyorKey' in d, false, 'ключ конструктор не трогает');
});

test('sbot-settings: мусор и пустые значения не ломают настройки', () => {
  const d = SBS.fromGlobals({
    tapyorCmdOrder: '', tapyorWho: 'king', tapyorFollowDays: 'abc', tapyorPerUser: '-4',
    tapyorPauseMin: '99999', tapyorChatCap: '0', tapyorDoubt: 'maybe', tapyorReplyAs: 'me',
    tapyorReplyMode: 'shout', tapyorRewardName: '   ', tapyorTxtQueued: 42,
  });
  assert.deepEqual(d.tapyorCmdOrder, [], 'стример стёр команды — так и показываем');
  assert.equal(d.tapyorWho, 'all');
  assert.equal(d.tapyorFollowDays, 0, 'нечисло — умолчание');
  assert.equal(d.tapyorPerUser, 1, 'минус — не лимит, а закрытый приём: умолчание');
  assert.equal(d.tapyorPauseMin, 1440, 'верхняя граница');
  assert.equal(d.tapyorChatCap, 1, 'нижняя граница');
  assert.equal(d.tapyorDoubt, 'wait');
  assert.equal(d.tapyorReplyAs, 'broadcaster');
  assert.equal(d.tapyorReplyMode, 'reply');
  assert.equal(d.tapyorRewardName, SBS.DEFAULT_REWARD);
  assert.equal(d.tapyorTxtQueued, '42');
});

test('sbot-settings: команды — до 10, без повторов, в нижнем регистре', () => {
  assert.deepEqual(SBS.splitCommands('!sr, !SR , , !play'), ['!sr', '!play']);
  assert.deepEqual(SBS.splitCommands(['!a', '!b', '!a']), ['!a', '!b']);
  const many = Array.from({ length: 15 }, (_, i) => '!c' + i).join(', ');
  assert.equal(SBS.splitCommands(many).length, 10);
  assert.deepEqual(SBS.splitCommands(''), []);
});

test('sbot-settings: сравнение с последней записью — только переменные конструктора', () => {
  const written = SBS.toValues(SBS.defaultDraft());
  assert.deepEqual(SBS.diffValues({}, null), [], 'ничего не записали — полосы нет');
  assert.deepEqual(SBS.diffValues(SBS.fromGlobals(written), written), [], 'то же самое — тишина');

  // В Streamer.bot поменяли вручную потолок очереди.
  const changed = Object.assign({}, written, { tapyorChatCap: 15 });
  assert.deepEqual(SBS.diffValues(changed, written), ['tapyorChatCap']);

  // Служебные переменные и адрес порта не считаются изменением конструктора.
  const extra = Object.assign({}, written, { tapyorChatCap: 15, tapyorUrl: 'http://127.0.0.1:1', tapyorTest: 'x', tapyorPendingRedemptions: '1:2' });
  assert.deepEqual(SBS.diffValues(extra, written), ['tapyorChatCap']);

  // Запись в другом формате («да» вместо 1) — не изменение.
  const asWords = Object.assign({}, written, { tapyorVipFree: 'да', tapyorPoints: 'true', tapyorPauseReward: '1' });
  assert.deepEqual(SBS.diffValues(asWords, written), []);

  // Переменную стёрли в Streamer.bot — это изменение: вернётся умолчание.
  const gone = Object.assign({}, written, { tapyorPauseMin: 12 });
  assert.deepEqual(SBS.diffValues(gone, written), ['tapyorPauseMin']);
});

test('sbot-settings: valuesMatch — записали и увидели то же в Streamer.bot', () => {
  const vals = SBS.toValues(SBS.defaultDraft());
  assert.equal(SBS.valuesMatch(SBS.fromGlobals(vals), vals), true);
  assert.equal(SBS.valuesMatch({}, vals), false, 'пустые глобальные — ещё не записалось');
  const half = Object.assign({}, vals, { tapyorChatCap: 9 });
  assert.equal(SBS.valuesMatch(half, vals), false);
  // «да» вместо 1 и число строкой — то же самое
  const words = Object.assign({}, vals, { tapyorVipFree: 'да', tapyorChatCap: '10' });
  assert.equal(SBS.valuesMatch(words, vals), true);
  // Служебные ключи не мешают
  const extra = Object.assign({}, vals, { tapyorUrl: 'http://x', tapyorTest: '1' });
  assert.equal(SBS.valuesMatch(extra, vals), true);
  // Проверяем только ожидаемые ключи: лишние переменные в Streamer.bot — не наше дело
  assert.equal(SBS.valuesMatch(extra, { tapyorWho: 'all' }), true);
});

test('sbot-settings: выключили «За баллы» — награда на паузу, включили при открытом приёме — снять', () => {
  assert.equal(SBS.pointsPauseAction('1', '0', true), 'close', 'выключили — пауза награды');
  assert.equal(SBS.pointsPauseAction('true', '0', false), 'close');
  assert.equal(SBS.pointsPauseAction('0', '1', true), 'open', 'включили при открытом приёме — снять паузу');
  assert.equal(SBS.pointsPauseAction('0', '1', false), '', 'приём закрыт — награду не открываем');
  assert.equal(SBS.pointsPauseAction('1', '1', true), '', 'не менялось — не трогаем');
  assert.equal(SBS.pointsPauseAction(undefined, '1', true), '', 'переменной не было — считаем «включено»');
});

test('sbot-settings: фраза «сейчас так» собирается из переменных', () => {
  const base = SBS.summary(SBS.defaultDraft());
  assert.match(base, /^Сейчас так: заказывают все командой !sr или !play/);
  assert.match(base, /не больше 1 трек у зрителя одновременно/);
  assert.match(base, /раз в 30 минут/);
  assert.match(base, /не больше 10 заказов из чата в очереди/);
  assert.match(base, /VIP и модераторы — без ограничений/);
  assert.match(base, /За баллы — с возвратом/);
  assert.match(base, /Сомнительные заказы ждут тебя во вкладке «Заказы»/);
  assert.match(base, /Отвечает в чат от твоего имени, веткой на сообщение\./);

  const other = SBS.summary({
    tapyorCmdOrder: ['!заказ'], tapyorOnOrder: false, tapyorWho: 'follower', tapyorFollowDays: 7,
    tapyorPerUser: 2, tapyorPauseMin: 0, tapyorChatCap: 5, tapyorVipFree: false, tapyorPoints: false,
    tapyorDoubt: 'ask', tapyorReplyAs: 'bot', tapyorReplyMode: 'msg',
  });
  assert.match(other, /заказ командой выключен/);
  assert.match(other, /не больше 2 трек[а-я]* у зрителя/);
  assert.match(other, /без паузы между заказами/);
  assert.match(other, /VIP и модераторы подчиняются общим правилам/);
  assert.match(other, /За баллы канала заказы выключены/);
  assert.match(other, /просят зрителя уточнить/);
  assert.match(other, /от бота, обычным сообщением/);

  const follower = SBS.summary({ tapyorWho: 'follower', tapyorFollowDays: 7 });
  assert.match(follower, /заказывают фолловеры, которые следят за каналом не меньше 7 дней командой/);
  const sub = SBS.summary({ tapyorWho: 'sub', tapyorFollowDays: 7 });
  assert.match(sub, /заказывают подписчики командой/);
});

test('sbot-settings: пустая переменная — значение по умолчанию, как GBool в шаблоне', () => {
  assert.equal(SBS.parseBool('', true), true, 'пусто = переменной нет, шаблон взял бы def');
  assert.equal(SBS.parseBool('   ', true), true);
  assert.equal(SBS.parseBool('', false), false);
  assert.equal(SBS.parseBool(null, true), true);
  assert.equal(SBS.parseBool(undefined, true), true);
  assert.equal(SBS.parseBool('0', true), false);
  const d = SBS.fromGlobals({ tapyorOnOrder: '', tapyorVipFree: '', tapyorPoints: '' });
  assert.equal(d.tapyorOnOrder, true);
  assert.equal(d.tapyorVipFree, true);
  assert.equal(d.tapyorPoints, true);
});

test('sbot-settings: список команд и подсказки для полей', () => {
  const list = SBS.enabledCommands({ tapyorCmdOrder: ['!q'], tapyorOnOrder: false });
  assert.equal(list.length, 5);
  assert.equal(list[0].title, 'Заказать песню');
  assert.deepEqual(list[0].commands, ['!q']);
  assert.equal(list[0].enabled, false);
  assert.equal(list[0].hint, '!play занята игрой Marbles on Stream — если она у тебя есть, убери');
  for (const r of SBS.REPLY_DEFS) assert.ok(SBS.replySample(r.key).length > 10);
  assert.equal(SBS.replySample('nope'), '');
});

test('sbot-settings: в подсказках только единый набор подстановок', () => {
  const allowed = ['user', 'track', 'place', 'eta', 'reason', 'min', 'who'];
  for (const r of SBS.REPLY_DEFS) {
    const found = (r.sample.match(/\{[^{}]+\}/g) || []).map((x) => x.slice(1, -1));
    for (const k of found) assert.ok(allowed.indexOf(k) >= 0, r.key + ': неизвестная подстановка {' + k + '}');
  }
  assert.equal(SBS.replySample('tapyorTxtPause').indexOf('{wait}'), -1, '{wait} больше нет — только {min}');
  assert.ok(SBS.replySample('tapyorTxtPause').indexOf('{min}') >= 0);
  assert.ok(SBS.replySample('tapyorTxtPause').indexOf('{user}') >= 0);
  assert.ok(SBS.replySample('tapyorTxtNoAccess').indexOf('{who}') >= 0);
});

test('sbot-settings: имена — ровно таблица 7.4 (без опечаток)', () => {
  const need = [
    'tapyorCmdOrder', 'tapyorOnOrder', 'tapyorWho', 'tapyorFollowDays', 'tapyorPerUser',
    'tapyorPauseMin', 'tapyorChatCap', 'tapyorVipFree', 'tapyorDoubt', 'tapyorPoints',
    'tapyorRewardName', 'tapyorPauseReward', 'tapyorReplyAs', 'tapyorReplyMode',
  ];
  for (const k of need) assert.ok(SBS.CONSTRUCTOR_VARS.indexOf(k) >= 0, 'нет переменной ' + k);
  for (const k of SBS.CONSTRUCTOR_VARS) assert.match(k, /^tapyor[A-Za-z]+$/);
  assert.equal(new Set(SBS.CONSTRUCTOR_VARS).size, SBS.CONSTRUCTOR_VARS.length, 'без повторов');
});
