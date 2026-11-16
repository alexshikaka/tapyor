import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sbot = require('../../src/sbot-port.js');
const texts = require('../../src/sbot-texts.js');

const KEY = 'tp_0123456789abcdefghijklmnopqrstuv';
const trackKino = { src: 'ym', id: '1', title: 'Кукушка', author: 'Кино', seconds: 160, duration: '2:40' };
const trackOther = { src: 'ym', id: '2', title: 'Мама', author: 'Кино', seconds: 200 };
const trackThird = { src: 'ym', id: '3', title: 'Группа крови', author: 'Кино', seconds: 180 };
const V = 2; // текущая версия шаблона в тестах (ниже проверяются старые)

function exact(t, alts) {
  return { level: 'exact', items: [{ level: 'exact', track: t || trackKino, alts: alts || [], paid: true }] };
}
function doubt(t, alts) {
  return { level: 'doubt', items: [{ level: 'doubt', track: t || trackKino, alts: alts || [], paid: true }] };
}
function none() { return { level: 'text', items: [] }; }

function sbRec(key, extra) {
  return Object.assign({
    key, prov: key.indexOf('sb-points:') === 0 ? 'sb-points' : 'sb-cmd', uid: '1', platform: 'twitch',
    name: 'test_viewer', state: 'new', got: Date.now(),
    items: [{ level: 'exact', track: trackKino, state: 'added', paid: true }],
  }, extra || {});
}

function qs(o) {
  const p = new URLSearchParams();
  for (const k of Object.keys(o || {})) if (o[k] != null) p.set(k, String(o[k]));
  return p.toString();
}

function make(over) {
  const logs = [], journalEntries = [], emitted = [], late = [];
  const state = {
    chatOrders: 'sbot',
    accepting: true,
    orders: [],
    queue: { keys: [], playing: '', items: [], now: null, curLeft: 0, next: [] },
    findOrder: async () => exact(),
    checkTrack: () => ({ ok: true }),
    addOrder: async () => ({ place: 3, etaSec: 480 }),
    removeOrder: () => {},
    control: () => ({ ok: true }),
    setAccepting: () => {},
  };
  const deps = Object.assign({
    version: '0.35.0',
    key: KEY,
    log: (m) => logs.push(String(m)),
    journal: { append: (e) => journalEntries.push(e) },
    getChatOrders: () => state.chatOrders,
    getAccepting: () => state.accepting,
    findOrder: (...a) => state.findOrder(...a),
    checkTrack: (t) => state.checkTrack(t),
    addOrder: (...a) => state.addOrder(...a),
    removeOrder: (k) => { state.removed = k; state.removeOrder(k); },
    queueState: () => state.queue,
    listOrders: () => state.orders,
    emitEvent: (...a) => emitted.push(a),
    onLateResult: (ctx, r) => late.push({ ctx, r }),
    control: (...a) => state.control(...a),
    setAccepting: (v) => state.setAccepting(v),
    deadlineMs: 2000,
    searchMax: 3,
    searchQueueMax: 100,
    templateCurrent: V,
    templateMin: 1,
  }, over || {});
  const port = sbot.createPort(deps);
  return { port, state, logs, journal: journalEntries, emitted, late };
}

async function api(port, path, params, opts) {
  const o = opts || {};
  let url = '/sb/' + path;
  const sp = qs(params);
  if (sp) url += '?' + sp;
  if (o.key !== false) {
    const k = o.key == null ? KEY : o.key;
    if (k) url += (sp ? '&' : '?') + 'key=' + encodeURIComponent(k);
  }
  return port.handle({ method: o.method || 'GET', url, headers: o.headers || {} });
}

function orderParams(extra) {
  return Object.assign({ user: 'test_viewer', uid: '1', platform: 'twitch', kind: 'cmd', text: 'кино кукушка', msg: 'm1', v: V }, extra || {});
}

test('sbot-port: константы и сравнение ключа', () => {
  assert.equal(sbot.DEADLINE_MS, 8000, 'дедлайн ответа 8 с');
  assert.equal(sbot.TEMPLATE_CURRENT, 1);
  assert.equal(sbot.TEMPLATE_MIN, 1);
  assert.equal(sbot.SEARCH_MAX, 3);
  assert.equal(sbot.SEARCH_QUEUE_MAX, 100);
  assert.equal(sbot.keyMatches(KEY, KEY), true);
  assert.equal(sbot.keyMatches(KEY, KEY + 'x'), false);
  assert.equal(sbot.keyMatches('', KEY), false);
  assert.equal(sbot.keyMatches(null, null), true, 'пустой с пустым — одинаково');
});

test('sbot-port: до готовности порта — 503 starting без данных', () => {
  const r = sbot.startingReply();
  assert.equal(r.code, 503, 'не 200 — порт ещё не готов');
  assert.deepEqual(r.body, { status: 'starting' }, 'никаких данных и обхода ключа');
});

test('sbot-port: без ключа и с неверным ключом — 401 auth, ключ не пишется в лог', async () => {
  const { port, logs } = make();
  const noKey = await api(port, 'ping', {}, { key: false });
  assert.equal(noKey.code, 401);
  assert.equal(noKey.body.status, 'auth');
  const bad = await api(port, 'ping', {}, { key: 'tp_wrong' });
  assert.equal(bad.code, 401);
  assert.equal(bad.body.status, 'auth');
  assert.equal(logs.join('\n').indexOf(KEY), -1, 'значение ключа не в логе');
});

test('sbot-port: ключ в заголовке X-Tapyor-Key и в параметре key', async () => {
  const { port } = make();
  const byHeader = await api(port, 'ping', {}, { key: false, headers: { 'x-tapyor-key': KEY } });
  assert.equal(byHeader.code, 200);
  assert.equal(byHeader.body.status, 'ok');
  assert.equal(byHeader.body.tapyor, '0.35.0');
  const byQuery = await api(port, 'ping', { key: KEY }, { key: false });
  assert.equal(byQuery.code, 200);
  assert.equal(byQuery.body.status, 'ok');
});

test('sbot-port: любой Origin — 403 origin (то же без ключа)', async () => {
  const { port } = make();
  const r = await api(port, 'order', orderParams(), { headers: { origin: 'https://evil.example' } });
  assert.equal(r.code, 403);
  assert.deepEqual(r.body, { status: 'origin' });
  const empty = await api(port, 'ping', {}, { key: false, headers: { origin: '' } });
  assert.equal(empty.code, 403);
});

test('sbot-port: только GET', async () => {
  const { port } = make();
  const r = await api(port, 'ping', {}, { method: 'POST' });
  assert.equal(r.code, 405);
});

test('sbot-port: заказ ставится — queued, место и время, журнал с ником, лог без ника', async () => {
  const { port, state, journal, logs } = make();
  const r = await api(port, 'order', orderParams());
  assert.equal(r.code, 200);
  assert.equal(r.body.status, 'queued');
  assert.equal(r.body.track, 'Кино — Кукушка');
  assert.equal(r.body.artist, 'Кино');
  assert.equal(r.body.title, 'Кукушка');
  assert.equal(r.body.place, 3);
  assert.equal(r.body.etaMin, 8);
  assert.equal(r.body.refund, false);
  assert.match(r.body.reply, /^@test_viewer поставил: Кино — Кукушка, через ~8 мин\. Если песня не та — !cancel$/);
  assert.match(r.body.orderId, /^sb-cmd:sc[0-9a-z]+$/);
  assert.equal(r.body.templateOk, true);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].ev, 'order');
  assert.equal(journal[0].user, 'test_viewer');
  assert.equal(journal[0].text, 'кино кукушка');
  assert.equal(journal[0].status, 'queued');
  const logText = logs.join('\n');
  assert.equal(logText.indexOf('test_viewer'), -1, 'ника нет в логе');
  assert.equal(logText.indexOf('кино кукушка'), -1, 'текста заказа нет в логе');
});

test('sbot-port: команда в начале текста отрезается по cmd', async () => {
  const { port, state } = make();
  let gotText = '';
  state.findOrder = async (text) => { gotText = text; return exact(); };
  const r = await api(port, 'order', orderParams({ text: '!sr кино кукушка', cmd: '!sr' }));
  assert.equal(r.body.status, 'queued');
  assert.equal(gotText, 'кино кукушка');
  // слово, не совпадающее с cmd, не трогаем
  gotText = '';
  await api(port, 'order', orderParams({ text: 'кино кукушка', cmd: '!play', msg: 'm2' }));
  assert.equal(gotText, 'кино кукушка');
});

test('sbot-port: повтор того же msg и redemption — тот же ответ, второго поиска нет', async () => {
  const { port, state, journal } = make();
  let calls = 0;
  state.findOrder = async () => { calls++; return exact(); };
  const first = await api(port, 'order', orderParams({ msg: 'm-repeat' }));
  await new Promise((r) => setImmediate(r)); // кэш записывается в том же переходе
  const second = await api(port, 'order', orderParams({ msg: 'm-repeat' }));
  assert.equal(calls, 1, 'второго поиска нет');
  assert.equal(second.body.status, first.body.status);
  assert.equal(second.body.orderId, first.body.orderId);
  assert.equal(journal.length, 1, 'второй записи в журнале нет');

  // redemption (баллы) — своя метка, тот же ответ
  calls = 0;
  const p = orderParams({ kind: 'points', msg: null, redemption: 'red-1' });
  const a = await api(port, 'order', p);
  await new Promise((r) => setImmediate(r));
  const b = await api(port, 'order', p);
  assert.equal(calls, 1);
  assert.equal(b.body.status, a.body.status);
  // другой msg — новый заказ
  await api(port, 'order', orderParams({ msg: 'm-other' }));
  assert.equal(calls, 2);
});

test('sbot-port: notfound', async () => {
  const { port, state } = make();
  state.findOrder = async () => none();
  const r = await api(port, 'order', orderParams());
  assert.equal(r.body.status, 'notfound');
  assert.match(r.body.reply, /не понял, что ставить/);
  assert.equal(r.body.refund, false);
  assert.equal(r.body.place, '');
});

test('sbot-port: длинный ответ обрезается до 480 символов с многоточием', async () => {
  const { port, state } = make();
  const long = { src: 'ym', id: '9', title: 'Н'.repeat(300), author: 'А'.repeat(200), seconds: 200 };
  state.findOrder = async () => exact(long);
  const r = await api(port, 'order', orderParams({ msg: 'long1' }));
  assert.equal(r.body.status, 'queued');
  assert.ok(r.body.reply.length <= texts.REPLY_MAX, 'не длиннее 480: Twitch не примет больше 500');
  assert.equal(r.body.reply.slice(-1), '…', 'обрезано с многоточием');
});

test('sbot-port: правила трека — status rule, для баллов возврат', async () => {
  const { port, state } = make({ templateCurrent: V });
  state.checkTrack = () => ({ ok: false, reason: 'tooLong' });
  const cmd = await api(port, 'order', orderParams({ msg: 'r1' }));
  assert.equal(cmd.body.status, 'rule');
  assert.equal(cmd.body.reason, 'трек слишком длинный');
  assert.match(cmd.body.reply, /не могу поставить: трек слишком длинный/);
  assert.equal(cmd.body.refund, false, 'за команду деньги не возвращаем');
  const pts = await api(port, 'order', orderParams({ kind: 'points', msg: 'r2', redemption: 'red-2' }));
  assert.equal(pts.body.status, 'rule');
  assert.equal(pts.body.refund, true, 'за баллы — возврат');
});

test('sbot-port: лимит зрителя (perUser по умолчанию 1)', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1')];
  state.queue = {
    keys: ['sb-cmd:sc1'], playing: '', curLeft: 0, next: [], now: null,
    items: [{ key: 'sb-cmd:sc1', seconds: 180, artist: 'Кино', title: 'Кукушка' }],
  };
  const r = await api(port, 'order', orderParams({ msg: 'lim1' }));
  assert.equal(r.body.status, 'limit');
  assert.equal(r.body.track, 'Кино — Кукушка');
  assert.equal(r.body.place, 1, 'место ждущего заказа — для {place} в своей фразе');
  assert.match(r.body.reply, /у тебя уже ждёт трек: Кино — Кукушка/);
  assert.equal(r.body.refund, false);
});

test('sbot-port: perUser считается по площадке и uid', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1', { uid: '1', platform: 'twitch' })];
  state.queue = { keys: ['sb-cmd:sc1'], playing: '', items: [], now: null, curLeft: 0, next: [] };
  const other = await api(port, 'order', orderParams({ uid: '2', msg: 'p2' }));
  assert.equal(other.body.status, 'queued', 'другому зрителю можно');
  const otherPlatform = await api(port, 'order', orderParams({ uid: '1', platform: 'youtube', msg: 'p3' }));
  assert.equal(otherPlatform.body.status, 'queued', 'другая площадка — другой зритель');
});

test('sbot-port: потолок очереди chatCap (по умолчанию 10)', async () => {
  const { port, state } = make();
  const list = [];
  const keys = [];
  for (let i = 0; i < 10; i++) { const k = 'sb-cmd:sc' + (100 + i); list.push(sbRec(k, { uid: String(100 + i) })); keys.push(k); }
  state.orders = list;
  state.queue = { keys, playing: '', items: [], now: null, curLeft: 0, next: [] };
  const r = await api(port, 'order', orderParams({ uid: '999', msg: 'cap1' }));
  assert.equal(r.body.status, 'limit');
  assert.match(r.body.reply, /очередь заказов полна/);
  assert.match(r.body.reason, /очередь/);
  // верхний предел 200 у chatCap: 10 заказов — не помеха
  const wide = await api(port, 'order', orderParams({ uid: '999', chatCap: 200, msg: 'cap2' }));
  assert.equal(wide.body.status, 'queued');
});

test('sbot-port: безопасные значения — мусор в perUser/chatCap/doubt', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1')];
  state.queue = { keys: ['sb-cmd:sc1'], playing: '', items: [], now: null, curLeft: 0, next: [] };
  // мусор в perUser → 1, значит лимит
  const junk = await api(port, 'order', orderParams({ perUser: 'ыва', msg: 'j1' }));
  assert.equal(junk.body.status, 'limit');
  // perUser 999 → верхний предел 20: два заказа — не лимит
  const high = await api(port, 'order', orderParams({ perUser: 999, msg: 'j2' }));
  assert.equal(high.body.status, 'queued');
});

test('sbot-port: сомнение wait — pending без автоприёма', async () => {
  const { port, state } = make();
  let addOpts = null;
  state.findOrder = async () => doubt();
  state.addOrder = async (rec, o) => { addOpts = o; return { place: null, etaSec: null }; };
  const r = await api(port, 'order', orderParams({ doubt: 'wait', msg: 'd1' }));
  assert.equal(r.body.status, 'pending');
  assert.match(r.body.reply, /принято: Кино — Кукушка — ждёт стримера/);
  assert.equal(addOpts.wait, false, 'pending не ждёт места в очереди');
});

test('sbot-port: сомнение ask — в очередь не ставим, просим уточнить', async () => {
  const { port, state } = make();
  let added = 0;
  state.addOrder = async () => { added++; return { place: 1, etaSec: 60 }; };
  state.findOrder = async () => doubt(trackKino, [trackOther]);
  const many = await api(port, 'order', orderParams({ doubt: 'ask', msg: 'a1' }));
  assert.equal(many.body.status, 'ask');
  assert.match(many.body.reply, /нашёл варианты: 1\) Кино — Кукушка 2\) Кино — Мама/);
  // один вариант — «ты имел в виду …?»
  state.findOrder = async () => doubt(trackKino, []);
  const one = await api(port, 'order', orderParams({ doubt: 'ask', msg: 'a2' }));
  assert.equal(one.body.status, 'ask');
  assert.match(one.body.reply, /ты имел в виду «Кино — Кукушка»\? Напиши точнее/);
  assert.equal(added, 0, 'в очередь ничего не встало');
});

test('sbot-port: сомнительный трек проверяется правилами — rule и без постановки', async () => {
  const { port, state } = make();
  let added = 0;
  state.findOrder = async () => doubt(trackKino);
  state.checkTrack = () => ({ ok: false, reason: 'explicit' });
  state.addOrder = async () => { added++; return { place: null, etaSec: null }; };
  const r = await api(port, 'order', orderParams({ doubt: 'wait', msg: 'd-rule' }));
  assert.equal(r.body.status, 'rule');
  assert.equal(r.body.reason, 'трек с пометкой 18+');
  assert.match(r.body.reply, /не могу поставить: трек с пометкой 18\+/);
  assert.equal(added, 0, 'нарушающий правила трек не попал даже в «под сомнением»');
  const pts = await api(port, 'order', orderParams({ kind: 'points', doubt: 'wait', msg: 'd-rule2', redemption: 'r-dr2' }));
  assert.equal(pts.body.status, 'rule');
  assert.equal(pts.body.refund, true, 'за баллы — возврат');
});

test('sbot-port: у сомнительного заказа сохраняются alts и flags найденного варианта', async () => {
  const { port, state } = make();
  let rec = null;
  state.findOrder = async () => ({
    level: 'doubt',
    items: [{ level: 'doubt', track: trackKino, alts: [trackOther, trackThird], flags: [{ k: 'explicit', t: '18+' }], paid: true }],
  });
  state.addOrder = async (r) => { rec = r; return { place: null, etaSec: null }; };
  const r = await api(port, 'order', orderParams({ doubt: 'wait', msg: 'd-alts' }));
  assert.equal(r.body.status, 'pending');
  assert.ok(rec, 'заказ создан');
  assert.deepEqual(rec.items[0].alts.map((t) => t.id), ['2', '3'], 'варианты перенесены');
  assert.deepEqual(rec.items[0].flags.map((f) => f.k), ['explicit'], 'пометки перенесены');
});

test('sbot-port: закрытый приём — closed, возврат за баллы', async () => {
  const { port, state } = make();
  state.accepting = false;
  const cmd = await api(port, 'order', orderParams({ msg: 'c1' }));
  assert.equal(cmd.body.status, 'closed');
  assert.equal(cmd.body.refund, false);
  assert.match(cmd.body.reply, /приём заказов сейчас закрыт/);
  const pts = await api(port, 'order', orderParams({ kind: 'points', msg: 'c2', redemption: 'r-c2' }));
  assert.equal(pts.body.refund, true);
});

test('sbot-port: chatOrders не sbot — off с пустым ответом на order и cancel', async () => {
  const { port, state } = make();
  state.chatOrders = 'none';
  const o = await api(port, 'order', orderParams());
  assert.equal(o.body.status, 'off');
  assert.equal(o.body.reply, '');
  assert.equal(o.body.refund, false);
  const pts = await api(port, 'order', orderParams({ kind: 'points', msg: 'o2', redemption: 'r-o2' }));
  assert.equal(pts.body.status, 'off');
  assert.equal(pts.body.refund, true, 'за баллы — возврат');
  const c = await api(port, 'cancel', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(c.body.status, 'off');
  assert.equal(c.body.reply, '');
});

test('sbot-port: версия шаблона — old без v и для v<min, templateOk=false для совместимой старой', async () => {
  const { port } = make();
  const noV = await api(port, 'order', orderParams({ v: null }));
  assert.equal(noV.body.status, 'old');
  assert.equal(noV.body.templateOk, false);
  assert.match(noV.body.reply, /обнови шаблон Тапёра в Streamer\.bot/);
  const zero = await api(port, 'order', orderParams({ v: 0 }));
  assert.equal(zero.body.status, 'old');
  const oldCompatible = await api(port, 'order', orderParams({ v: 1, msg: 'compat' }));
  assert.equal(oldCompatible.body.status, 'queued');
  assert.equal(oldCompatible.body.templateOk, false, 'старая, но совместимая');
  const fresh = await api(port, 'order', orderParams({ v: 2, msg: 'fresh' }));
  assert.equal(fresh.body.templateOk, true);
});

test('sbot-port: ошибка поиска — error, для баллов возврат', async () => {
  const { port, state, logs } = make();
  state.findOrder = async () => { throw new Error('сеть отвалилась'); };
  const r = await api(port, 'order', orderParams({ kind: 'points', msg: 'e1', redemption: 'r-e1' }));
  assert.equal(r.body.status, 'error');
  assert.equal(r.body.refund, true);
  assert.match(r.body.reply, /не получилось поставить заказ/);
  assert.equal(logs.join('\n').indexOf('test_viewer'), -1);
});

test('sbot-port: дедлайн 8 с — search, поиск продолжается, итог в onLateResult', async () => {
  const { port, state, late } = make({ deadlineMs: 50 });
  let resolveSearch = null;
  let calls = 0;
  state.findOrder = () => { calls++; return new Promise((res) => { resolveSearch = res; }); };
  let added = 0;
  state.addOrder = async () => { added++; return { place: 2, etaSec: 120 }; };
  const first = await api(port, 'order', orderParams({ msg: 'late1', text: '!sr @everyone https://evil.example free nitro' }));
  assert.equal(first.body.status, 'search');
  assert.match(first.body.reply, /ищу — отвечу в чате/, 'общая фраза без текста зрителя');
  assert.equal(first.body.reply.indexOf('@everyone'), -1, 'упоминание из текста не попало в чат');
  assert.equal(first.body.reply.indexOf('https://'), -1, 'ссылка из текста не попала в чат');
  assert.equal(first.body.refund, false);
  // повтор, пока идёт поиск — тот же search, второго поиска нет
  const again = await api(port, 'order', orderParams({ msg: 'late1' }));
  assert.equal(again.body.status, 'search');
  assert.equal(calls, 1, 'поиск один');
  // поиск закончился позже — колбэк, заказ всё-таки встал
  resolveSearch(exact());
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(added, 1, 'заказ поставлен после дедлайна');
  assert.equal(late.length, 1);
  assert.equal(late[0].r.status, 'queued');
  assert.equal(late[0].ctx.user, 'test_viewer');
});

test('sbot-port: не больше 3 поисков, очередь 100 — сверх ошибка «слишком много заказов»', async () => {
  const { port, state } = make({ deadlineMs: 1000, searchMax: 1, searchQueueMax: 1 });
  state.findOrder = () => new Promise((res) => setTimeout(() => res(exact()), 30));
  const p1 = api(port, 'order', orderParams({ uid: '1', msg: 'q1' }));
  const p2 = api(port, 'order', orderParams({ uid: '2', msg: 'q2' }));
  await new Promise((r) => setImmediate(r));
  const third = await api(port, 'order', orderParams({ uid: '3', msg: 'q3' }));
  assert.equal(third.body.status, 'error');
  assert.match(third.body.reply, /слишком много заказов сразу, попробуй через минуту/);
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a.body.status, 'queued');
  assert.equal(b.body.status, 'queued', 'второй дождался места');
});

test('sbot-port: /sb/now, /sb/place, /sb/next, /sb/status — плоские поля', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1')];
  state.queue = {
    keys: ['sb-cmd:sc1'], playing: 'sb-points:sp9',
    items: [{ key: 'sb-cmd:sc1', seconds: 120, artist: 'Кино', title: 'Кукушка' }],
    now: { orderId: 'sb-points:sp9', track: 'Кино — Мама', artist: 'Кино', title: 'Мама', who: 'test_viewer', seconds: 200 },
    curLeft: 30,
    next: [{ artist: 'Кино', title: 'Кукушка', seconds: 120 }, { artist: 'Кино', title: 'Группа крови', seconds: 180 }, { artist: 'A', title: 'B', seconds: 60 }],
  };
  const now = await api(port, 'now', { v: V });
  assert.equal(now.body.status, 'ok');
  assert.equal(now.body.playing, 1);
  assert.equal(now.body.track, 'Кино — Мама');
  assert.equal(now.body.user, 'test_viewer');
  const place = await api(port, 'place', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(place.body.status, 'ok');
  assert.equal(place.body.place, 1);
  assert.equal(place.body.etaMin, 1); // 30 с до конца текущего → минимум 1 минута
  const next = await api(port, 'next', { n: 2, v: V });
  assert.equal(next.body.status, 'ok');
  assert.equal(next.body.count, 2);
  assert.equal(next.body.list, '1. Кино — Кукушка | 2. Кино — Группа крови');
  const st = await api(port, 'status', {});
  assert.equal(st.body.status, 'ok');
  assert.equal(st.body.accepting, 1);
  assert.equal(st.body.orders, 1);
  assert.equal(st.body.playing, 1);
  assert.equal(st.body.chatOrders, 'sbot');
  assert.equal(st.body.tapyor, '0.35.0');
});

test('sbot-port: /sb/place у зрителя без заказа и у играющего', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1')];
  state.queue = { keys: [], playing: 'sb-cmd:sc1', items: [], now: null, curLeft: 0, next: [] };
  const playing = await api(port, 'place', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(playing.body.status, 'playing');
  assert.equal(playing.body.place, 0);
  const noBody = await api(port, 'place', { user: 'other', uid: '42', platform: 'twitch', v: V });
  assert.equal(noBody.body.status, 'none');
  assert.match(noBody.body.reply, /твоего заказа сейчас нет в очереди/);
});

test('sbot-port: /sb/cancel убирает последний заказ; у баллов — событие dropped/cancel', async () => {
  const { port, state, emitted, journal } = make();
  state.orders = [
    sbRec('sb-cmd:sc1', { got: Date.now() - 5000 }),
    sbRec('sb-points:sp2', { got: Date.now(), items: [{ level: 'exact', track: trackOther, state: 'added', paid: true }] }),
  ];
  state.queue = { keys: ['sb-cmd:sc1', 'sb-points:sp2'], playing: '', items: [], now: null, curLeft: 0, next: [] };
  const r = await api(port, 'cancel', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(r.body.status, 'cancelled');
  assert.equal(r.body.orderId, 'sb-points:sp2');
  assert.match(r.body.reply, /заказ отменён/);
  assert.equal(state.removed, 'sb-points:sp2');
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], ['dropped', 'sb-points:sp2', 'cancel']);
  assert.equal(journal[journal.length - 1].ev, 'cancel');
  // нечего отменять
  state.orders = [];
  const none = await api(port, 'cancel', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(none.body.status, 'nothing');
  assert.match(none.body.reply, /нечего отменять/);
});

test('sbot-port: /sb/control — skip, pause, play, vol 0–100', async () => {
  const { port, state } = make();
  const calls = [];
  state.control = (what, value) => { calls.push([what, value]); return { ok: true, volume: value }; };
  for (const what of ['skip', 'pause', 'play']) {
    const r = await api(port, 'control', { do: what, v: V });
    assert.equal(r.body.status, 'ok');
  }
  const vol = await api(port, 'control', { do: 'vol', value: 150, v: V });
  assert.equal(vol.body.status, 'ok');
  assert.equal(vol.body.volume, 100, 'громкость ограничена 100');
  assert.deepEqual(calls[3], ['vol', 100]);
  const bad = await api(port, 'control', { do: 'vol', v: V });
  assert.equal(bad.body.status, 'error');
  const unknown = await api(port, 'control', { do: 'взорвать', v: V });
  assert.equal(unknown.body.status, 'error');
});

test('sbot-port: /sb/accept открывает и закрывает приём', async () => {
  const { port, state } = make();
  const seen = [];
  state.setAccepting = (v) => seen.push(v);
  const off = await api(port, 'accept', { on: 0 });
  assert.equal(off.body.status, 'ok');
  assert.equal(off.body.accepting, 0);
  const on = await api(port, 'accept', { on: '1' });
  assert.equal(on.body.status, 'ok');
  assert.equal(on.body.accepting, 1);
  assert.deepEqual(seen, [false, true]);
  const bad = await api(port, 'accept', { on: 'может быть' });
  assert.equal(bad.body.status, 'error');
});

test('sbot-port: неизвестный /sb/* — плоская ошибка, не 500', async () => {
  const { port } = make();
  const r = await api(port, 'zzz', {});
  assert.equal(r.code, 200);
  assert.equal(r.body.status, 'error');
});

test('sbot-port: /sb/ack подтверждает событие ящика только с ключом и известным id', async () => {
  const seen = [];
  const { port, journal } = make({ onAck: (id) => { seen.push(id); return id === 'event-1'; } });
  const ok = await api(port, 'ack', { id: 'event-1' });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.status, 'ok');
  assert.equal(ok.body.acked, 1);
  assert.deepEqual(seen, ['event-1']);
  assert.ok(journal.some((e) => e.ev === 'ack' && e.eventId === 'event-1' && e.ok === 1));

  const unknown = await api(port, 'ack', { id: 'event-2' });
  assert.equal(unknown.body.acked, 0, 'неизвестный id — не ошибка, просто 0');

  const noId = await api(port, 'ack', {});
  assert.equal(noId.body.status, 'ok');
  assert.equal(noId.body.acked, 0);

  const beforeBad = seen.length;
  const bad = await api(port, 'ack', { id: 'плохой id с пробелами' });
  assert.equal(bad.body.acked, 0);
  assert.equal(seen.length, beforeBad, 'мусорный id не доходит до ящика');

  const noKey = await api(port, 'ack', { id: 'event-1' }, { key: false });
  assert.equal(noKey.code, 401, 'подтверждение — тоже только с ключом порта');
});

test('sbot-port: ключ можно сменить без пересоздания порта (getKey)', async () => {
  let current = 'tp_first_key_0123456789';
  const { port } = make({ key: undefined, getKey: () => current });
  const one = await api(port, 'ping', {}, { key: 'tp_first_key_0123456789' });
  assert.equal(one.code, 200);
  current = 'tp_second_key_0123456789';
  const old = await api(port, 'ping', {}, { key: 'tp_first_key_0123456789' });
  assert.equal(old.code, 401, 'старый ключ после смены не работает');
  const fresh = await api(port, 'ping', {}, { key: 'tp_second_key_0123456789' });
  assert.equal(fresh.code, 200);
});

test('sbot-port: заказ за баллы сохраняет reward и redemption для возврата', async () => {
  const saved = [];
  const { port, state } = make({ addOrder: async (rec) => { saved.push(rec); return { place: 1, etaSec: 60 }; } });
  state.orders = [];
  const r = await api(port, 'order', orderParams({ kind: 'points', reward: 'Заказать песню', redemption: 'red-77' }));
  assert.equal(r.body.status, 'queued');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].reward, 'Заказать песню');
  assert.equal(saved[0].redemption, 'red-77');
  assert.equal(saved[0].prov, 'sb-points');
});

test('sbot-port: текст ответов берётся из sbot-texts', () => {
  assert.match(texts.make('queued', { ник: '@x', трек: 'A — B', время: '3 мин' }), /^@x поставил: A — B, через ~3 мин/);
  assert.equal(texts.REASONS.tooLong, 'трек слишком длинный');
  assert.equal(texts.fmtTime(null), 'скоро');
  assert.equal(texts.fmtTime(30), '1 мин');
  // {ник} — это «@ник» или пусто; uid в него не попадает
  assert.equal(texts.nick('test_viewer'), '@test_viewer');
  assert.equal(texts.nick('@test_viewer'), '@test_viewer');
  assert.equal(texts.nick(''), '');
  assert.equal(texts.nick(null), '');
  // пустой ник не оставляет «, твой трек…» и не оставляет строчную первую букву
  assert.equal(texts.make('placePlaying', { ник: '' }), 'Твой трек уже играет');
  assert.equal(texts.make('queued', { ник: '', трек: 'A — B', время: '3 мин' }), 'Поставил: A — B, через ~3 мин. Если песня не та — !cancel');
  // собственные фразы без ника не трогаем
  assert.equal(texts.make('old'), 'обнови шаблон Тапёра в Streamer.bot');
  assert.equal(texts.make('overload'), 'слишком много заказов сразу, попробуй через минуту');
});

test('sbot-port: free=1 — стример без проверок очереди, perUser и chatCap не мешают', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1')];
  state.queue = { keys: ['sb-cmd:sc1'], playing: '', items: [], now: null, curLeft: 0, next: [] };
  // тот же uid без free — лимит «у тебя уже ждёт трек»
  const capped = await api(port, 'order', orderParams({ msg: 'f1' }));
  assert.equal(capped.body.status, 'limit');
  // стример (free=1) — ставится, хотя заказ уже ждёт
  const freeOne = await api(port, 'order', orderParams({ user: 'streamer', uid: '999', free: 1, msg: 'f2' }));
  assert.equal(freeOne.body.status, 'queued');
  assert.match(freeOne.body.reply, /^@streamer поставил:/);
  // free=true — тоже доверенный флаг
  const freeTrue = await api(port, 'order', orderParams({ user: 'moder', uid: '998', free: 'true', msg: 'f3' }));
  assert.equal(freeTrue.body.status, 'queued');

  // полная очередь заказов (chatCap 10): обычному зрителю — «полна», free — ставится
  const list = [], keys = [];
  for (let i = 0; i < 10; i++) { const k = 'sb-cmd:sc' + (200 + i); list.push(sbRec(k, { uid: String(200 + i) })); keys.push(k); }
  state.orders = list;
  state.queue = { keys, playing: '', items: [], now: null, curLeft: 0, next: [] };
  const full = await api(port, 'order', orderParams({ uid: '777', msg: 'f4' }));
  assert.equal(full.body.status, 'limit');
  assert.match(full.body.reply, /очередь заказов полна/);
  const freeFull = await api(port, 'order', orderParams({ uid: '777', free: 1, msg: 'f5' }));
  assert.equal(freeFull.body.status, 'queued');
  // free не отменяет закрытый приём: шаблон всё равно получает отказ
  state.accepting = false;
  const freeClosed = await api(port, 'order', orderParams({ uid: '777', free: 1, msg: 'f6' }));
  assert.equal(freeClosed.body.status, 'closed');
});

test('sbot-port: free=0 — обычные проверки очереди', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1')];
  state.queue = { keys: ['sb-cmd:sc1'], playing: '', items: [], now: null, curLeft: 0, next: [] };
  const r = await api(port, 'order', orderParams({ free: 0, msg: 'f7' }));
  assert.equal(r.body.status, 'limit');
});

test('sbot-port: !cancel не снимает играющий заказ — status playing, без события', async () => {
  const { port, state, emitted, journal } = make();
  state.orders = [sbRec('sb-points:sp1')];
  state.queue = {
    keys: [], playing: 'sb-points:sp1', items: [],
    now: { orderId: 'sb-points:sp1', track: 'Кино — Кукушка', artist: 'Кино', title: 'Кукушка', who: 'test_viewer', seconds: 160 },
    curLeft: 100, next: [],
  };
  const r = await api(port, 'cancel', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(r.body.status, 'playing');
  assert.equal(r.body.orderId, 'sb-points:sp1');
  assert.equal(r.body.track, 'Кино — Кукушка');
  assert.equal(r.body.reply, '@test_viewer, твой трек уже играет — отменить нельзя');
  assert.equal(state.removed, undefined, 'играющий заказ не снят');
  assert.equal(emitted.length, 0, 'баллы не возвращаются событием');
  assert.equal(journal.filter((e) => e.ev === 'cancel').length, 0);
});

test('sbot-port: !cancel при играющем и ожидающем снимает только ожидающий', async () => {
  const { port, state } = make();
  state.orders = [
    sbRec('sb-cmd:sc1', { items: [{ level: 'exact', track: trackKino, state: 'added', paid: true }] }),
    sbRec('sb-cmd:sc2', { items: [{ level: 'exact', track: trackOther, state: 'added', paid: true }] }),
  ];
  state.queue = { keys: ['sb-cmd:sc2'], playing: 'sb-cmd:sc1', items: [], now: null, curLeft: 30, next: [] };
  const r = await api(port, 'cancel', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(r.body.status, 'cancelled');
  assert.equal(r.body.orderId, 'sb-cmd:sc2');
  assert.equal(state.removed, 'sb-cmd:sc2');
});

test('sbot-port: /sb/now — «Сейчас играет…» и «Сейчас ничего не играет»', async () => {
  const { port, state } = make();
  state.queue = { keys: [], playing: '', items: [], now: null, curLeft: 0, next: [] };
  const none = await api(port, 'now', { v: V });
  assert.equal(none.body.status, 'none');
  assert.equal(none.body.reply, 'Сейчас ничего не играет');

  state.queue = {
    keys: ['sb-cmd:sc1'], playing: 'sb-cmd:sc1', items: [],
    now: { orderId: 'sb-cmd:sc1', track: 'Кино — Кукушка', artist: 'Кино', title: 'Кукушка', who: 'test_viewer', seconds: 160 },
    curLeft: 100, next: [],
  };
  const ok = await api(port, 'now', { v: V });
  assert.equal(ok.body.status, 'ok');
  assert.equal(ok.body.reply, 'Сейчас играет: Кино — Кукушка — заказал @test_viewer');

  // обычный трек (не заказ) — без «заказал @…»
  state.queue.playing = '';
  state.queue.now = { orderId: '', track: 'Кино — Мама', artist: 'Кино', title: 'Мама', who: '', seconds: 200 };
  const plain = await api(port, 'now', { v: V });
  assert.equal(plain.body.reply, 'Сейчас играет: Кино — Мама');
});

test('sbot-port: /sb/place — ответы для чата (ждёт, играет, нет заказа, ждёт стримера)', async () => {
  const { port, state } = make();
  state.orders = [sbRec('sb-cmd:sc1')];
  state.queue = {
    keys: ['sb-cmd:sc1'], playing: '',
    items: [{ key: 'sb-cmd:sc1', seconds: 150, artist: 'Кино', title: 'Кукушка' }],
    now: null, curLeft: 30, next: [],
  };
  const waiting = await api(port, 'place', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(waiting.body.status, 'ok');
  assert.equal(waiting.body.reply, '@test_viewer, Кино — Кукушка — 1-й, через ~1 мин');

  state.queue.playing = 'sb-cmd:sc1';
  const playing = await api(port, 'place', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(playing.body.status, 'playing');
  assert.equal(playing.body.reply, '@test_viewer, твой трек уже играет');
  // шаблон не прислал user — фраза без «@», uid в текст не попадает
  const anon = await api(port, 'place', { uid: '1', platform: 'twitch', v: V });
  assert.equal(anon.body.reply, 'Твой трек уже играет');
  assert.equal(anon.body.reply.indexOf('1'), -1, 'uid не подставлен');

  const noBody = await api(port, 'place', { user: 'other', uid: '42', platform: 'twitch', v: V });
  assert.equal(noBody.body.status, 'none');
  assert.equal(noBody.body.reply, '@other твоего заказа сейчас нет в очереди');

  // заказ-сомнение ещё ждёт стримера (в очередь не встал)
  state.orders = [{
    key: 'sb-cmd:sc9', prov: 'sb-cmd', uid: '1', platform: 'twitch', name: 'test_viewer', state: 'new', got: Date.now(),
    items: [{ level: 'doubt', track: trackKino, paid: true }],
  }];
  state.queue = { keys: [], playing: '', items: [], now: null, curLeft: 0, next: [] };
  const pending = await api(port, 'place', { user: 'test_viewer', uid: '1', platform: 'twitch', v: V });
  assert.equal(pending.body.status, 'pending');
  assert.equal(pending.body.reply, '@test_viewer, твой заказ ждёт подтверждения стримера');
});

test('sbot-port: /sb/control — короткие ответы в чат', async () => {
  const { port, state, journal } = make();
  state.queue = {
    keys: [], playing: 'sb-cmd:sc1', items: [],
    now: { orderId: 'sb-cmd:sc1', track: 'Кино — Кукушка', artist: 'Кино', title: 'Кукушка', who: 'test_viewer', seconds: 160 },
    curLeft: 100, next: [],
  };
  const skip = await api(port, 'control', { do: 'skip', user: 'moder', v: V });
  assert.equal(skip.body.status, 'ok');
  assert.equal(skip.body.reply, 'Пропустил: Кино — Кукушка');
  // в журнале — ник, uid и трек; в чат они не уходят
  const last = journal[journal.length - 1];
  assert.equal(last.ev, 'control');
  assert.equal(last.user, 'moder');
  assert.equal(last.track, 'Кино — Кукушка');

  state.queue.now = null;
  state.queue.playing = '';
  const nothing = await api(port, 'control', { do: 'skip', v: V });
  assert.equal(nothing.body.reply, 'Нечего пропускать');
  const pause = await api(port, 'control', { do: 'pause', v: V });
  assert.equal(pause.body.reply, 'Пауза');
  const play = await api(port, 'control', { do: 'play', v: V });
  assert.equal(play.body.reply, 'Играю дальше');
  const vol = await api(port, 'control', { do: 'vol', value: 40, v: V });
  assert.equal(vol.body.status, 'ok');
  assert.equal(vol.body.reply, 'Громкость 40');
  assert.equal(vol.body.volume, 40);
});

test('sbot-port: /sb/next — «Дальше…» и «Очередь пуста»', async () => {
  const { port, state } = make();
  state.queue = { keys: [], playing: '', items: [], now: null, curLeft: 0, next: [trackKino, trackOther] };
  const r = await api(port, 'next', { n: 2, v: V });
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.reply, 'Дальше: 1. Кино — Кукушка | 2. Кино — Мама');
  state.queue.next = [];
  const empty = await api(port, 'next', { v: V });
  assert.equal(empty.body.reply, 'Очередь пуста');
});

test('sbot-port: заказ заиграл сразу — «играет сейчас», а не «через ~1 мин»', async () => {
  const { port } = make({ addOrder: async () => ({ place: 1, etaSec: 0 }) });
  const r = await api(port, 'order', orderParams());
  assert.equal(r.body.status, 'queued');
  assert.equal(r.body.reply, '@test_viewer ставлю: Кино — Кукушка — играет сейчас');
  assert.equal(r.body.place, 1);
  assert.equal(r.body.etaMin, 0, 'играет сейчас — ждать нечего');
  // место 1, но перед треком ещё играет текущий (ETA 2 мин) — обычная фраза
  const { port: p2 } = make({ addOrder: async () => ({ place: 1, etaSec: 120 }) });
  const w = await api(p2, 'order', orderParams({ msg: 'w1' }));
  assert.match(w.body.reply, /поставил: Кино — Кукушка, через ~2 мин/);
  assert.equal(w.body.etaMin, 2);
  // окно не посчитало ETA, но снимок уже говорит, что играет именно этот заказ
  const { port: p3, state: s3 } = make();
  s3.addOrder = async (rec) => {
    s3.queue = { keys: [], playing: rec.key, items: [], now: null, curLeft: 0, next: [] };
    return { place: 1, etaSec: 150 };
  };
  const nowPlaying = await api(p3, 'order', orderParams({ msg: 'w2' }));
  assert.equal(nowPlaying.body.reply, '@test_viewer ставлю: Кино — Кукушка — играет сейчас');
  assert.equal(nowPlaying.body.etaMin, 0);
});

test('sbot-port: без user в чат не подставляется uid', async () => {
  const { port, state } = make();
  const r = await api(port, 'order', orderParams({ user: null, uid: '1000001' }));
  assert.equal(r.body.status, 'queued');
  assert.equal(r.body.reply.indexOf('1000001'), -1, 'uid не в ответе');
  assert.equal(r.body.reply.indexOf('@'), -1, 'ника нет — «@» не остаётся');
  assert.match(r.body.reply, /^Поставил: Кино — Кукушка/);

  state.orders = [sbRec('sb-cmd:sc1', { uid: '1000001' })];
  state.queue = { keys: ['sb-cmd:sc1'], playing: '', items: [], now: null, curLeft: 0, next: [] };
  const c = await api(port, 'cancel', { uid: '1000001', platform: 'twitch', v: V });
  assert.equal(c.body.status, 'cancelled');
  assert.equal(c.body.reply, 'Заказ отменён');
});

test('sbot-port: при боте пака шаблон молчит — off и пустой reply у now/place/next/control', async () => {
  const { port, state } = make();
  state.chatOrders = 'pack';
  const cases = [['now', { v: V }], ['place', { user: 'x', uid: '1', platform: 'twitch', v: V }], ['next', { v: V }], ['control', { do: 'skip', v: V }]];
  for (const [p, params] of cases) {
    const r = await api(port, p, params);
    assert.equal(r.body.status, 'off', p);
    assert.equal(r.body.reply, '', p);
  }
});
