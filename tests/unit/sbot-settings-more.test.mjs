// T1: дополнение к sbot-settings.test.mjs — устройство конструктора, нормализация
// испорченных значений, запись в Streamer.bot и сравнение.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../src/sbot-settings.js');

// ---------- описание конструктора ----------

test('sbot-settings: пять команд, у каждой пара «команда + выключатель»', () => {
  assert.equal(S.CMD_DEFS.length, 5);
  assert.equal(new Set(S.CMD_DEFS.map((c) => c.cmd)).size, 5);
  for (const c of S.CMD_DEFS) {
    assert.match(c.cmd, /^tapyorCmd/);
    assert.match(c.on, /^tapyorOn/);
    assert.ok(Array.isArray(c.def) && c.def.length > 0, c.cmd);
    assert.equal(typeof c.title, 'string');
  }
  assert.deepEqual(S.CMD_DEFS[0].def, ['!sr', '!play']);
});

test('sbot-settings: наборы значений и границы лимитов на месте', () => {
  assert.deepEqual(S.WHO, ['all', 'follower', 'sub', 'vip']);
  assert.deepEqual(S.DOUBT, ['wait', 'ask']);
  assert.deepEqual(S.REPLY_AS, ['broadcaster', 'bot']);
  assert.deepEqual(S.REPLY_MODE, ['reply', 'msg']);
  assert.deepEqual(S.LIMITS.tapyorPerUser, [1, 20]);
  assert.deepEqual(S.LIMITS.tapyorChatCap, [1, 200]);
  assert.equal(S.DEFAULT_REWARD, 'Заказать песню');
});

test('sbot-settings.defaultDraft: умолчания собираются из описания', () => {
  const d = S.defaultDraft();
  assert.equal(d.tapyorWho, 'all');
  assert.equal(d.tapyorFollowDays, 0);
  assert.equal(d.tapyorPerUser, 1);
  assert.equal(d.tapyorPauseMin, 30);
  assert.equal(d.tapyorChatCap, 10);
  assert.equal(d.tapyorVipFree, true);
  assert.equal(d.tapyorDoubt, 'wait');
  assert.equal(d.tapyorPoints, true);
  assert.equal(d.tapyorRewardName, 'Заказать песню');
  assert.equal(d.tapyorReplyAs, 'broadcaster');
  assert.equal(d.tapyorReplyMode, 'reply');
  assert.deepEqual(d.tapyorCmdOrder, ['!sr', '!play']);
  assert.equal(d.tapyorOnOrder, true);
  for (const r of S.REPLY_DEFS) assert.equal(d[r.key], '');
});

// ---------- normalizeDraft ----------

test('sbot-settings.normalizeDraft: массив, строка, null и мусор — умолчания', () => {
  for (const raw of [null, undefined, [], 'строка', 42]) {
    const d = S.normalizeDraft(raw);
    assert.equal(d.tapyorPerUser, 1);
    assert.equal(d.tapyorChatCap, 10);
  }
});

test('sbot-settings.normalizeDraft: неизвестные значения заменяются безопасными', () => {
  const d = S.normalizeDraft({
    tapyorWho: 'все', tapyorDoubt: 'может', tapyorReplyAs: 'никто', tapyorReplyMode: 'как-то',
    tapyorFollowDays: 'много', tapyorPerUser: 0, tapyorPauseMin: -10, tapyorChatCap: 9999,
    tapyorVipFree: 'может', tapyorPoints: '', tapyorRewardName: '   ',
  });
  assert.equal(d.tapyorWho, 'all');
  assert.equal(d.tapyorDoubt, 'wait');
  assert.equal(d.tapyorReplyAs, 'broadcaster');
  assert.equal(d.tapyorReplyMode, 'reply');
  assert.equal(d.tapyorFollowDays, 0);
  assert.equal(d.tapyorPerUser, 1);
  assert.equal(d.tapyorPauseMin, 0);
  assert.equal(d.tapyorChatCap, 200);
  assert.equal(d.tapyorVipFree, true, 'непонятное «да/нет» — как в шаблоне, включено');
  assert.equal(d.tapyorPoints, true, 'пустая переменная — умолчание');
  assert.equal(d.tapyorRewardName, 'Заказать песню');
});

test('sbot-settings.normalizeDraft: команды, тексты и числа приводятся к виду конструктора', () => {
  const d = S.normalizeDraft({
    tapyorCmdOrder: '!sr, !play, !sr,  , !request',
    tapyorOnSong: '0',
    tapyorPerUser: '12.7',
    tapyorFollowDays: 3650,
    tapyorTxtQueued: 'а'.repeat(400),
  });
  assert.deepEqual(d.tapyorCmdOrder, ['!sr', '!play', '!request']);
  assert.equal(d.tapyorOnSong, false);
  assert.equal(d.tapyorPerUser, 13);
  assert.equal(d.tapyorFollowDays, 3650);
  assert.equal(d.tapyorTxtQueued.length, 300);
});

// ---------- fromGlobals / toValues ----------

test('sbot-settings.fromGlobals: значения Streamer.bot накладываются на базу', () => {
  const base = S.defaultDraft();
  base.tapyorPauseMin = 5;
  const d = S.fromGlobals({ tapyorPerUser: '3', tapyorDoubt: 'ask', чужое: 'x', tapyorUrl: 'https://x' }, base);
  assert.equal(d.tapyorPerUser, 3);
  assert.equal(d.tapyorDoubt, 'ask');
  assert.equal(d.tapyorPauseMin, 5, 'чего нет в Streamer.bot — остаётся из базы');
  assert.equal('чужое' in d, false);
  assert.equal('tapyorUrl' in d, false);
});

test('sbot-settings.toValues: только переменные конструктора, «да/нет» как 1/0', () => {
  const v = S.toValues(S.defaultDraft());
  for (const k of S.CONSTRUCTOR_VARS) assert.ok(k in v, 'нет ' + k);
  assert.equal(v.tapyorOnOrder, '1');
  assert.equal(v.tapyorVipFree, '1');
  assert.equal(v.tapyorPoints, '1');
  assert.equal(v.tapyorPauseReward, '1');
  assert.equal(v.tapyorCmdOrder, '!sr, !play');
  assert.equal(v.tapyorPerUser, 1);
  assert.equal(v.tapyorChatCap, 10);
  assert.equal('tapyorUrl' in v, false);
  assert.equal('tapyorKey' in v, false);

  const off = S.toValues({ tapyorOnOrder: false, tapyorVipFree: '0' });
  assert.equal(off.tapyorOnOrder, '0');
  assert.equal(off.tapyorVipFree, '0');
});

// ---------- diffValues / valuesMatch ----------

test('sbot-settings.diffValues: без прошлой записи сравнивать нечего', () => {
  assert.deepEqual(S.diffValues({}, null), []);
  assert.deepEqual(S.diffValues({}, {}), []);
  assert.deepEqual(S.diffValues(null, null), []);
});

test('sbot-settings.diffValues: ручная правка в Streamer.bot видна, чужие переменные — нет', () => {
  const written = S.defaultDraft();
  assert.deepEqual(S.diffValues(S.toValues(written), written), []);
  const changed = Object.assign({}, S.toValues(written), { tapyorPerUser: '3', tapyorUrl: 'другой' });
  assert.deepEqual(S.diffValues(changed, written), ['tapyorPerUser']);
});

test('sbot-settings.valuesMatch: запись ещё не дошла — false, дошла — true', () => {
  const expected = S.toValues(S.defaultDraft());
  assert.equal(S.valuesMatch({}, expected), false, 'переменных ещё нет');
  assert.equal(S.valuesMatch(expected, expected), true);
  assert.equal(S.valuesMatch(Object.assign({}, expected, { tapyorPerUser: 5 }), expected), false);
  assert.equal(S.valuesMatch({}, { tapyorUrl: 'x' }), true, 'чужие ключи не сравниваются');
});

// ---------- pointsPauseAction ----------

test('sbot-settings.pointsPauseAction: выключили — пауза, включили при открытом приёме — снять', () => {
  assert.equal(S.pointsPauseAction(true, false, true), 'close');
  assert.equal(S.pointsPauseAction('1', '0', true), 'close');
  assert.equal(S.pointsPauseAction(false, true, true), 'open');
  assert.equal(S.pointsPauseAction(false, true, false), '');
  assert.equal(S.pointsPauseAction(true, true, true), '');
});

// ---------- summary / replySample / enabledCommands ----------

test('sbot-settings.summary: обычная настройка описывается по-русски', () => {
  const text = S.summary(S.defaultDraft());
  assert.ok(text.startsWith('Сейчас так: '));
  assert.ok(text.includes('заказывают все командой !sr или !play'));
  assert.ok(text.includes('не больше 1 трек у зрителя одновременно'));
  assert.ok(text.includes('раз в 30 минут'));
  assert.ok(text.includes('не больше 10 заказов из чата в очереди'));
  assert.ok(text.includes('VIP и модераторы — без ограничений'));
  assert.ok(text.includes('За баллы — с возвратом'));
  assert.ok(text.includes('Сомнительные заказы ждут тебя'));
  assert.ok(text.includes('от твоего имени, веткой на сообщение'));
});

test('sbot-settings.summary: выключенный заказ, пустая команда, фолловеры и пауза', () => {
  const off = S.summary({ tapyorOnOrder: false });
  assert.ok(off.includes('заказ командой выключен'));
  const noCmd = S.summary({ tapyorCmdOrder: [] });
  assert.ok(noCmd.includes('команда заказа не задана'));
  const follower = S.summary({ tapyorWho: 'follower', tapyorFollowDays: 5 });
  assert.ok(follower.includes('фолловеры, которые следят за каналом не меньше 5 дней'));
  const sub = S.summary({ tapyorWho: 'sub' });
  assert.ok(sub.includes('заказывают подписчики'));
  const vip = S.summary({ tapyorWho: 'vip' });
  assert.ok(vip.includes('заказывают VIP и модераторы'));
  const noPause = S.summary({ tapyorPauseMin: 0 });
  assert.ok(noPause.includes('без паузы между заказами'));
  const noPoints = S.summary({ tapyorPoints: false });
  assert.ok(noPoints.includes('За баллы канала заказы выключены'));
  const ask = S.summary({ tapyorDoubt: 'ask' });
  assert.ok(ask.includes('просят зрителя уточнить'));
  const bot = S.summary({ tapyorReplyAs: 'bot', tapyorReplyMode: 'msg' });
  assert.ok(bot.includes('от бота, обычным сообщением'));
});

test('sbot-settings.replySample: пример есть у известного ключа и пусто у неизвестного', () => {
  assert.ok(S.replySample('tapyorTxtQueued').includes('{track}'));
  assert.equal(S.replySample('нет-такого'), '');
});

test('sbot-settings.enabledCommands: пять галочек с командами и подсказками', () => {
  const list = S.enabledCommands({ tapyorOnSkip: false, tapyorCmdSong: ['!now'] });
  assert.equal(list.length, 5);
  const song = list.find((x) => x.cmd === 'tapyorCmdSong');
  assert.deepEqual(song.commands, ['!now']);
  const skip = list.find((x) => x.cmd === 'tapyorCmdSkip');
  assert.equal(skip.enabled, false);
});

// ---------- внутренние помощники ----------

test('sbot-settings._internal: числа, склонения и перечисление команд', () => {
  assert.equal(S._internal.parseInt2('12.7', 0, 1, 20), 13);
  assert.equal(S._internal.parseInt2('', 5, 0, 10), 5);
  assert.equal(S._internal.parseInt2('abc', 5, 0, 10), 5);
  assert.equal(S._internal.parseInt2('-3', 0, 0, 10), 0);
  assert.equal(S._internal.parseInt2(999, 0, 0, 10), 10);

  assert.equal(S._internal.plural(1, 'трек', 'трека', 'треков'), 'трек');
  assert.equal(S._internal.plural(2, 'трек', 'трека', 'треков'), 'трека');
  assert.equal(S._internal.plural(5, 'трек', 'трека', 'треков'), 'треков');
  assert.equal(S._internal.plural(11, 'трек', 'трека', 'треков'), 'треков');
  assert.equal(S._internal.plural(21, 'трек', 'трека', 'треков'), 'трек');
  assert.equal(S._internal.plural(22, 'трек', 'трека', 'треков'), 'трека');

  assert.equal(S._internal.commandText([]), '');
  assert.equal(S._internal.commandText(['a']), 'a');
  assert.equal(S._internal.commandText(['a', 'b', 'c']), 'a, b или c');
  assert.equal(S._internal.commandText(null), '');
});
