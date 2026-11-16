'use strict';
// Проверки заказов из чата по очереди — общие для порта Streamer.bot (0.35, Э1).
// Чистый модуль: ни Electron, ни сети, ни файлов. Принимает записи заказов из requests.json
// (их ведёт главный процесс) и снимок живой очереди из окна. Покрыт tests/unit/chatorders.test.mjs.
//
// Смысл: Streamer.bot проверяет «кто и как часто», а «сколько уже стоит у зрителя» и
// «не полна ли очередь заказов» знает только Тапёр — по реальной очереди.

const DEFAULTS = { perUser: 1, chatCap: 10, doubt: 'wait' };
const MAX = { perUser: 20, chatCap: 200 };
// Карточка заказа живёт в «Заказах» сутки. Более старый «ждущий стримера» заказ не должен
// навсегда занимать лимит зрителя и очередь, даже если запись осталась в requests.json.
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function toInt(v) {
  if (typeof v === 'number' && isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return NaN;
}

// Безопасные значения: нет числа или мусор — значение по умолчанию, не «без ограничений».
// 0 и минус тоже считаем мусором: «ни одного заказа» — это не лимит, а закрытый приём.
function safeInt(v, def, hi) {
  const n = toInt(v);
  if (!isFinite(n) || n < 1) return def;
  return n > hi ? hi : n;
}

function safeLimits(q) {
  const s = q || {};
  return {
    perUser: safeInt(s.perUser, DEFAULTS.perUser, MAX.perUser),
    chatCap: safeInt(s.chatCap, DEFAULTS.chatCap, MAX.chatCap),
    doubt: s.doubt === 'ask' ? 'ask' : DEFAULTS.doubt,
  };
}

function isSbKey(key) {
  return /^sb-(?:cmd|points):[A-Za-z0-9_-]+$/.test(String(key || ''));
}

function trackOf(rec) {
  const items = Array.isArray(rec && rec.items) ? rec.items : [];
  for (const it of items) if (it && it.track) return it.track;
  return null;
}

function trackLabel(t) {
  if (!t) return '';
  // У треков поиска исполнитель в author, у снимка окна — в artist.
  const a = t.author || t.artist || '';
  return (a ? a + ' — ' : '') + (t.title || '');
}

// Заказ ещё ждёт, играет или ждёт подтверждения стримера (сомнение)?
// items.state === 'added' — уже в очереди (смотрим по живой очереди окна);
// без added и без skip — карточка в «Заказах» ждёт решения (тоже занимает лимит, как у бота пака).
function activeOrder(rec, queue) {
  if (!rec || !isSbKey(rec.key) || rec.state === 'dismissed') return null;
  // Заказ снят (уборка при запуске или вручную) — он уже не ждёт и не играет, лимит не занимает.
  if (rec.droppedAt) return null;
  const items = Array.isArray(rec.items) ? rec.items : [];
  if (items.some((it) => it && it.state === 'skip')) return null;
  const track = trackOf(rec);
  const q = queue || {};
  const playing = String(q.playing || '');
  const keys = q.keys;
  const inQueue = keys == null ? null : (keys instanceof Set ? keys.has(rec.key) : Array.isArray(keys) && keys.indexOf(rec.key) >= 0);
  const added = items.some((it) => it && it.state === 'added');
  if (added) {
    if (rec.key === playing) return { key: rec.key, playing: true, pending: false, track, rec };
    // Окно ещё не прислало очередь (запуск): считаем, что заказ ещё ждёт, — лишний отказ безопаснее.
    if (inQueue == null) return { key: rec.key, playing: false, pending: false, track, rec };
    if (inQueue) return { key: rec.key, playing: false, pending: false, track, rec };
    return null; // добавили и уже убрали/сыграл и кончился
  }
  if (rec.got && Date.now() - Number(rec.got) > PENDING_TTL_MS) return null;
  return { key: rec.key, playing: false, pending: true, track, rec };
}

function activeOrders(list, queue) {
  const src = Array.isArray(list) ? list : [];
  const out = [];
  for (const rec of src) {
    const a = activeOrder(rec, queue);
    if (a) out.push(a);
  }
  return out;
}

// Заказы конкретного зрителя: площадка + uid. Ник не годится — он меняется.
function viewerActive(list, queue, viewer) {
  const v = viewer || {};
  const uid = String(v.uid == null ? '' : v.uid);
  const platform = String(v.platform || '');
  return activeOrders(list, queue).filter((o) => {
    const rec = o.rec;
    return rec && String(rec.uid == null ? '' : rec.uid) === uid && String(rec.platform || '') === platform;
  });
}

// Сколько заказов из чата стоит в очереди (без того, что уже играет).
function chatWaiting(list, queue) {
  return activeOrders(list, queue).filter((o) => !o.playing).length;
}

// Номера списаний (redemption) всех заказов за баллы, которые реально ждут или играют.
// Это список для «Тапёр: сверка»: всё, чего в нём нет, шаблон закрывает. Через запятую.
function pendingRedemptions(list, queue) {
  const out = [];
  for (const o of activeOrders(list, queue)) {
    const rec = o.rec;
    if (!rec || !/^sb-points:/.test(String(rec.key || ''))) continue;
    const r = String(rec.redemption == null ? '' : rec.redemption).trim();
    if (r && out.indexOf(r) < 0) out.push(r);
  }
  return out.join(',');
}

// Как pendingRedemptions, но при неожиданных данных возвращает null — «список не построен».
// Пустая строка значит «доказанно пусто»: на ошибке сверка не должна отменять все списания.
function pendingRedemptionsSafe(list, queue) {
  try { return pendingRedemptions(list, queue); } catch (e) { return null; }
}

module.exports = {
  DEFAULTS,
  MAX,
  safeLimits,
  isSbKey,
  activeOrder,
  activeOrders,
  viewerActive,
  chatWaiting,
  pendingRedemptions,
  pendingRedemptionsSafe,
  trackLabel,
};
