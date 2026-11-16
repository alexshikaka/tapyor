// Настройки конструктора Streamer.bot (0.35, этап Э4) — docs/PLAN-STREAMERBOT.md, 7.4 и 8.
// Работает и в окне Тапёра (window.TapSBS), и в Node (для проверок) — как src/rank.js.
//
// Настройки заказов живут в Streamer.bot (глобальные переменные tapyor…). Конструктор в Тапёре
// только помогает их задать: читает из Streamer.bot, показывает по-русски, пишет обратно
// действием «Тапёр: настройка». Здесь — чистые функции: разбор значений, сборка для записи,
// сравнение «в Streamer.bot изменили вручную», фраза «сейчас так» и тексты-подсказки.
// Без Electron, сети и файлов — покрыто tests/unit/sbot-settings.test.mjs.
//
// Имена переменных — ровно как в таблице 7.4 плана. Шаблон понимает «да/нет» как 1/0,
// true/false и да/нет; пишем 1/0 (решение Э4).
//
// Тексты ответов: план не перечисляет имена, в задании Э3а — `tapyorTxt<Status>`. Здесь
// выбран набор по статусам порта (queued / pending / notfound / rule / limit / pause /
// noAccess); список записан в docs/DECISIONS.md, чтобы шаблон Э3 совпал с конструктором.
// Отдельного `tapyorTxtCap` нет: порт отвечает `limit` и на «уже ждёт», и на «очередь полна»,
// а шаблон ищет текст по статусу — поле «Очередь полна» в конструкторе всё равно не работало бы.

(function (root) {
  'use strict';

const CMD_DEFS = [
  {
    cmd: 'tapyorCmdOrder', on: 'tapyorOnOrder', title: 'Заказать песню', def: ['!sr', '!play'], onDef: true,
    hint: '!play занята игрой Marbles on Stream — если она у тебя есть, убери',
  },
  { cmd: 'tapyorCmdSong', on: 'tapyorOnSong', title: 'Что играет', def: ['!song'], onDef: true, hint: '' },
  { cmd: 'tapyorCmdPlace', on: 'tapyorOnPlace', title: 'Моё место в очереди', def: ['!place'], onDef: true, hint: '' },
  { cmd: 'tapyorCmdCancel', on: 'tapyorOnCancel', title: 'Отменить свой заказ', def: ['!cancel'], onDef: true, hint: 'За баллы — с возвратом' },
  { cmd: 'tapyorCmdSkip', on: 'tapyorOnSkip', title: 'Пропустить трек', def: ['!skip'], onDef: true, hint: 'Только модераторы и ты' },
];

// Тексты — в порядке макета. Пусто = фраза Тапёра; подсказка показывает пример.
// Подстановки — ровно один набор: {user} {track} {place} {eta} {reason} {min} {who}.
// Он же понимается в шаблоне Streamer.bot (10/11/20/21/32/36).
const REPLY_DEFS = [
  { key: 'tapyorTxtQueued', title: 'Поставил', sample: '@{user}, {track} — {place}-й, через ~{eta} мин. Отменить: !cancel' },
  { key: 'tapyorTxtPending', title: 'Ждёт стримера', sample: '@{user}, нашёл {track} — стример посмотрит' },
  { key: 'tapyorTxtNotFound', title: 'Не нашёл', sample: '@{user}, не нашёл. Пиши так: !sr исполнитель — песня, или ссылку' },
  { key: 'tapyorTxtRule', title: 'Не по правилам', sample: '@{user}, не могу поставить: {reason}' },
  { key: 'tapyorTxtLimit', title: 'Уже ждёт', sample: '@{user}, у тебя уже ждёт трек — {place}-й в очереди' },
  { key: 'tapyorTxtPause', title: 'Пауза', sample: '@{user}, следующий заказ через {min} мин' },
  { key: 'tapyorTxtNoAccess', title: 'Нет доступа', sample: '@{user}, заказы сейчас только для {who}' },
];

const WHO = ['all', 'follower', 'sub', 'vip'];
const DOUBT = ['wait', 'ask'];
const REPLY_AS = ['broadcaster', 'bot'];
const REPLY_MODE = ['reply', 'msg'];
const LIMITS = {
  tapyorFollowDays: [0, 3650],
  tapyorPerUser: [1, 20],
  tapyorPauseMin: [0, 1440],
  tapyorChatCap: [1, 200],
};

const DEFAULT_REWARD = 'Заказать песню';

// Все переменные, которые показывает конструктор. Другие (tapyorUrl, tapyorKey,
// tapyorRewardId, tapyorPendingRedemptions, tapyorTest*) экран не трогает и в сравнении
// «в Streamer.bot изменили» не участвуют.
const CONSTRUCTOR_VARS = [].concat(
  CMD_DEFS.map((c) => c.cmd),
  CMD_DEFS.map((c) => c.on),
  ['tapyorWho', 'tapyorFollowDays', 'tapyorPerUser', 'tapyorPauseMin', 'tapyorChatCap', 'tapyorVipFree'],
  ['tapyorDoubt'],
  ['tapyorPoints', 'tapyorRewardName', 'tapyorPauseReward'],
  ['tapyorReplyAs', 'tapyorReplyMode'],
  REPLY_DEFS.map((r) => r.key)
);

function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj || {}, k); }
function str(v, n) { return String(v == null ? '' : v).trim().slice(0, n == null ? 500 : n); }

function parseBool(v, def) {
  if (v === undefined || v === null) return !!def;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && isFinite(v);
  const s = String(v).trim().toLowerCase();
  // Пустая переменная — «её нет»: в шаблоне C# GBool при пустом значении берёт def (обычно «вкл»),
  // поэтому окно не должно показывать «выкл» и молча выключать при сохранении (A35-13).
  if (s === '') return !!def;
  if (['1', 'true', 'да', 'yes', 'on', 'вкл'].indexOf(s) >= 0) return true;
  if (['0', 'false', 'нет', 'no', 'off', 'выкл'].indexOf(s) >= 0) return false;
  return !!def;
}

function parseInt2(v, def, lo, hi) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const n = Number(String(v).replace(',', '.'));
  if (!isFinite(n)) return def;
  const i = Math.round(n);
  return Math.min(hi == null ? 1e9 : hi, Math.max(lo == null ? -1e9 : lo, i));
}

function splitCommands(v) {
  const raw = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  const out = [];
  for (const item of raw) {
    const s = str(item, 40).toLowerCase();
    if (!s || out.indexOf(s) >= 0) continue;
    out.push(s);
    if (out.length >= 10) break;
  }
  return out;
}

function oneOf(v, list, def) {
  const s = str(v, 30).toLowerCase();
  return list.indexOf(s) >= 0 ? s : def;
}

function defaultDraft() {
  const d = {
    tapyorWho: 'all', tapyorFollowDays: 0, tapyorPerUser: 1, tapyorPauseMin: 30, tapyorChatCap: 10,
    tapyorVipFree: true, tapyorDoubt: 'wait',
    tapyorPoints: true, tapyorRewardName: DEFAULT_REWARD, tapyorPauseReward: true,
    tapyorReplyAs: 'broadcaster', tapyorReplyMode: 'reply',
  };
  for (const c of CMD_DEFS) { d[c.cmd] = c.def.slice(); d[c.on] = c.onDef; }
  for (const r of REPLY_DEFS) d[r.key] = '';
  return d;
}

// Приводим любые (в том числе испорченные) значения к безопасному виду конструктора.
function normalizeDraft(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = defaultDraft();
  for (const c of CMD_DEFS) {
    if (has(src, c.cmd)) out[c.cmd] = splitCommands(src[c.cmd]);
    if (has(src, c.on)) out[c.on] = parseBool(src[c.on], c.onDef);
  }
  if (has(src, 'tapyorWho')) out.tapyorWho = oneOf(src.tapyorWho, WHO, 'all');
  if (has(src, 'tapyorFollowDays')) out.tapyorFollowDays = parseInt2(src.tapyorFollowDays, 0, LIMITS.tapyorFollowDays[0], LIMITS.tapyorFollowDays[1]);
  if (has(src, 'tapyorPerUser')) out.tapyorPerUser = parseInt2(src.tapyorPerUser, 1, LIMITS.tapyorPerUser[0], LIMITS.tapyorPerUser[1]);
  if (has(src, 'tapyorPauseMin')) out.tapyorPauseMin = parseInt2(src.tapyorPauseMin, 30, LIMITS.tapyorPauseMin[0], LIMITS.tapyorPauseMin[1]);
  if (has(src, 'tapyorChatCap')) out.tapyorChatCap = parseInt2(src.tapyorChatCap, 10, LIMITS.tapyorChatCap[0], LIMITS.tapyorChatCap[1]);
  if (has(src, 'tapyorVipFree')) out.tapyorVipFree = parseBool(src.tapyorVipFree, true);
  if (has(src, 'tapyorDoubt')) out.tapyorDoubt = src.tapyorDoubt === 'ask' ? 'ask' : 'wait';
  if (has(src, 'tapyorPoints')) out.tapyorPoints = parseBool(src.tapyorPoints, true);
  if (has(src, 'tapyorRewardName')) out.tapyorRewardName = str(src.tapyorRewardName, 100) || DEFAULT_REWARD;
  if (has(src, 'tapyorPauseReward')) out.tapyorPauseReward = parseBool(src.tapyorPauseReward, true);
  if (has(src, 'tapyorReplyAs')) out.tapyorReplyAs = oneOf(src.tapyorReplyAs, REPLY_AS, 'broadcaster');
  if (has(src, 'tapyorReplyMode')) out.tapyorReplyMode = oneOf(src.tapyorReplyMode, REPLY_MODE, 'reply');
  for (const r of REPLY_DEFS) if (has(src, r.key)) out[r.key] = str(src[r.key], 300);
  return out;
}

// Глобальные переменные Streamer.bot ({ имя: значение }) → черновик конструктора.
// Недостающие и испорченные значения берём из base (обычно — прошлый черновик или умолчания).
function fromGlobals(globals, base) {
  const g = globals && typeof globals === 'object' ? globals : {};
  const src = normalizeDraft(base || defaultDraft());
  for (const k of CONSTRUCTOR_VARS) if (has(g, k)) src[k] = g[k];
  return normalizeDraft(src);
}

// Черновик → значения для действия «Тапёр: настройка». Только tapyor-имена и только
// переменные конструктора; адрес и ключ порта подставляет сам Тапёр.
function toValues(raw) {
  const d = normalizeDraft(raw);
  const out = {};
  for (const c of CMD_DEFS) {
    out[c.cmd] = d[c.cmd].join(', ');
    out[c.on] = d[c.on] ? '1' : '0';
  }
  out.tapyorWho = d.tapyorWho;
  out.tapyorFollowDays = d.tapyorFollowDays;
  out.tapyorPerUser = d.tapyorPerUser;
  out.tapyorPauseMin = d.tapyorPauseMin;
  out.tapyorChatCap = d.tapyorChatCap;
  out.tapyorVipFree = d.tapyorVipFree ? '1' : '0';
  out.tapyorDoubt = d.tapyorDoubt;
  out.tapyorPoints = d.tapyorPoints ? '1' : '0';
  out.tapyorRewardName = d.tapyorRewardName;
  out.tapyorPauseReward = d.tapyorPauseReward ? '1' : '0';
  out.tapyorReplyAs = d.tapyorReplyAs;
  out.tapyorReplyMode = d.tapyorReplyMode;
  for (const r of REPLY_DEFS) out[r.key] = d[r.key];
  return out;
}

// Что в Streamer.bot изменили вручную: сравниваем только переменные конструктора.
// written — что Тапёр записал последним (null/ничего — сравнения нет).
function diffValues(globals, written) {
  if (!written || typeof written !== 'object' || !Object.keys(written).length) return [];
  const a = fromGlobals(globals, written);
  const b = fromGlobals(written, written);
  const out = [];
  for (const k of CONSTRUCTOR_VARS) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

// Совпадают ли значения, которые только что записали, с тем, что реально лежит в Streamer.bot.
// Нужно главному процессу: действие шаблона выполняется не мгновенно, и без проверки окно
// увидело бы старые переменные и показало «изменено в Streamer.bot» сразу после своей записи.
function valuesMatch(globals, expected) {
  const g = globals && typeof globals === 'object' ? globals : {};
  const exp = normalizeDraft(expected);
  const got = fromGlobals(g, expected);
  const want = expected && typeof expected === 'object' ? expected : {};
  for (const k of Object.keys(want)) {
    if (CONSTRUCTOR_VARS.indexOf(k) < 0) continue;
    if (!has(g, k)) return false;              // переменной ещё нет — действие не выполнилось
    if (JSON.stringify(got[k]) !== JSON.stringify(exp[k])) return false;
  }
  return true;
}

// Что сделать с наградой за баллы при смене галочки «Заказ за баллы» (A35-9):
// выключили — «Тапёр: приём» open:0 (пауза награды), включили при открытом приёме — open:1.
// Не менялось — пусто (ничего не трогаем).
function pointsPauseAction(prev, next, accepting) {
  const a = parseBool(prev, true);
  const b = parseBool(next, true);
  if (a === b) return '';
  if (!b) return 'close';
  return accepting ? 'open' : '';
}

function plural(n, one, few, many) {  const m100 = n % 100, m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}
function minutes(n) { return n + ' ' + plural(n, 'минуту', 'минуты', 'минут'); }
function tracks(n) { return n + ' ' + plural(n, 'трек', 'трека', 'треков'); }

function commandText(list) {
  const a = Array.isArray(list) ? list : [];
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' или ' + a[a.length - 1];
}

function whoText(d) {
  if (d.tapyorWho === 'follower') {
    if (d.tapyorFollowDays > 0) return 'фолловеры, которые следят за каналом не меньше ' + d.tapyorFollowDays + ' ' + plural(d.tapyorFollowDays, 'дня', 'дней', 'дней');
    return 'любые фолловеры';
  }
  if (d.tapyorWho === 'sub') return 'подписчики';
  if (d.tapyorWho === 'vip') return 'VIP и модераторы';
  return 'все';
}

// Строка простыми словами: что сейчас будет происходить. Без HTML.
function summary(raw) {
  const d = normalizeDraft(raw);
  const parts = [];
  const cmd = commandText(d.tapyorCmdOrder);
  if (!d.tapyorOnOrder) parts.push('заказ командой выключен');
  else if (cmd) parts.push('заказывают ' + whoText(d) + ' командой ' + cmd);
  else parts.push('команда заказа не задана');
  parts.push('не больше ' + tracks(d.tapyorPerUser) + ' у зрителя одновременно');
  parts.push(d.tapyorPauseMin > 0 ? 'раз в ' + minutes(d.tapyorPauseMin) : 'без паузы между заказами');
  parts.push('не больше ' + d.tapyorChatCap + ' заказов из чата в очереди');
  let text = 'Сейчас так: ' + parts.join(', ') + '.';
  text += d.tapyorVipFree ? ' VIP и модераторы — без ограничений.' : ' VIP и модераторы подчиняются общим правилам.';
  text += d.tapyorPoints
    ? ' За баллы — с возвратом, если трек не нашёлся или не заиграл.'
    : ' За баллы канала заказы выключены.';
  text += d.tapyorDoubt === 'ask'
    ? ' Сомнительные заказы просят зрителя уточнить песню.'
    : ' Сомнительные заказы ждут тебя во вкладке «Заказы».';
  const as = d.tapyorReplyAs === 'bot' ? 'от бота' : 'от твоего имени';
  const mode = d.tapyorReplyMode === 'msg' ? 'обычным сообщением' : 'веткой на сообщение';
  text += ' Отвечает в чат ' + as + ', ' + mode + '.';
  return text;
}

function replySample(key) {
  const r = REPLY_DEFS.find((x) => x.key === key);
  return r ? r.sample : '';
}

// Какие команды включены — для галочек в конструкторе.
function enabledCommands(raw) {
  const d = normalizeDraft(raw);
  return CMD_DEFS.map((c) => ({ cmd: c.cmd, on: c.on, title: c.title, hint: c.hint, commands: d[c.cmd].slice(), enabled: d[c.on] }));
}

const api = {
  CMD_DEFS,
  REPLY_DEFS,
  WHO,
  DOUBT,
  REPLY_AS,
  REPLY_MODE,
  LIMITS,
  DEFAULT_REWARD,
  CONSTRUCTOR_VARS,
  defaultDraft,
  normalizeDraft,
  fromGlobals,
  toValues,
  diffValues,
  valuesMatch,
  pointsPauseAction,
  summary,
  replySample,
  enabledCommands,
  parseBool,
  splitCommands,
  // для тестов
  _internal: { parseInt2, commandText, whoText, plural },
};

// В окне Тапёра тот же набор функций — window.TapSBS (как window.TapRank у rank.js).
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.TapSBS = api;
})(this);
