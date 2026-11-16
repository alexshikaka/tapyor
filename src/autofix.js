'use strict';
// Автопочинка (0.34.0, шаг 5). Диспетчер: сам решает, когда попробовать починить сервис.
//
// Правила владельца:
//   • при поломке Тапёр ОДИН раз пробует починить сам; повторно — только после ручного
//     «Починить» или перезапуска;
//   • лёгкие починки (повторить запрос, переподключить) — сразу;
//   • тяжёлые (обновить движок YouTube, скачать правила, проба сайта Яндекса) — только
//     когда музыка не играет; иначе ждут паузы до конца сессии;
//   • каждая попытка — короткое сообщение; не вышло — состояние «не вышло» для чеклиста;
//   • «вход отозван» не чиним сами: сразу показываем «войдите заново»;
//   • одну и ту же службу не чиним дважды одновременно, в цикл не уходим.
//
// Модуль без electron на верхнем уровне: всё внешнее (сеть, файлы, окна) приходит
// обработчиками. Покрыт tests/unit/autofix.test.mjs.

const NAMES = {
  youtube: 'YouTube',
  yandex: 'Яндекс Музыка',
  donationalerts: 'DonationAlerts',
  donatepay: 'DonatePay',
  twitch: 'Twitch',
  lastfm: 'Last.fm',
  github: 'GitHub',
  cloud: 'Облачные функции'
};

// Пороги «подряд»: сколько ошибок подряд нужно, чтобы Тапёр вмешался.
// Быстрая проверка даёт готовый вердикт — для неё всегда 1 (значение по умолчанию).
// Поток YouTube и сетевые ошибки Яндекса ловятся на ходу — им нужен запас, чтобы
// разовый сбой не запускал починку.
const THRESHOLDS = {
  youtube: { service: 1, login: 1, engine: 1, stream: 2 },
  yandex: { service: 1, login: 1, stream: 1, site: 1, rules: 1, api: 3 },
  donationalerts: { poll: 2 },
  donatepay: { poll: 2 },
  cloud: { check: 1 },
  lastfm: { check: 1 },
  twitch: { check: 1 },
  github: { check: 1 }
};

// Таблица починок: служба → список. У каждой записи: id, вид проблемы (kind), тяжёлая ли,
// что сделать (run) и чем проверить (verify). run/verify — имена обработчиков, которые
// передаёт главный процесс (src/main.js); в тестах можно передать свои функции.
const REPAIRS = {
  youtube: [
    { id: 'yt-retry', name: 'переподключение', kind: 'service', heavy: false, run: 'ytServiceFix', verify: 'ytCheck',
      text: 'YouTube отвалился — Тапёр переподключил' },
    { id: 'yt-login-check', name: 'перепроверка входа', kind: 'login', heavy: false, run: 'ytLoginCheck', verify: 'ytLoginVerify',
      text: 'Вход в YouTube проверен' },
    { id: 'ytdlp-update', name: 'обновление движка', kind: 'engine', heavy: true, run: 'ytdlpUpdate', verify: 'ytdlpVerify',
      text: 'YouTube отвалился — Тапёр переподключил', wait: 'Жду паузы, чтобы обновить движок YouTube' },
    { id: 'ytdlp-update-stream', name: 'обновление движка', kind: 'stream', heavy: true, run: 'ytdlpUpdate', verify: 'ytStreamVerify',
      text: 'YouTube отвалился — Тапёр переподключил', wait: 'Жду паузы, чтобы обновить движок YouTube' }
  ],
  yandex: [
    { id: 'ym-retry', name: 'переподключение', kind: 'service', heavy: false, run: 'ymServiceFix', verify: 'ymCheck',
      text: 'Яндекс отвалился — Тапёр переподключил' },
    { id: 'ym-retry-api', name: 'переподключение', kind: 'api', heavy: false, run: 'ymServiceFix', verify: 'ymCheck',
      text: 'Яндекс отвалился — Тапёр переподключил' },
    { id: 'ym-retry-stream', name: 'переподключение', kind: 'stream', heavy: false, run: 'ymServiceFix', verify: 'ymCheck',
      text: 'Яндекс отвалился — Тапёр переподключил' },
    { id: 'ym-login-check', name: 'перепроверка входа', kind: 'login', heavy: false, run: 'ymLoginCheck', verify: 'ymLoginVerify',
      text: 'Вход в Яндекс проверен' },
    { id: 'ym-site', name: 'починка сайта Яндекса', kind: 'site', heavy: true, run: 'ymSiteFix',
      text: 'Правила Яндекса устарели — Тапёр скачал новые', wait: 'Жду паузы, чтобы починить сайт Яндекса' },
    { id: 'recipes-refresh', name: 'скачивание правил', kind: 'rules', heavy: true, run: 'recipesRefresh', verify: 'recipesVerify',
      text: 'Правила сайтов обновлены', wait: 'Жду паузы, чтобы скачать свежие правила' }
  ],
  donationalerts: [
    { id: 'don-reconnect', name: 'переподключение', kind: 'poll', heavy: false, run: 'donReconnect',
      text: 'DonationAlerts отвалился — Тапёр переподключил' }
  ],
  donatepay: [
    { id: 'don-reconnect', name: 'переподключение', kind: 'poll', heavy: false, run: 'donReconnect',
      text: 'DonatePay отвалился — Тапёр переподключил' }
  ],
  cloud: [
    { id: 'cloud-retry', name: 'повтор проверки', kind: 'check', heavy: false, run: 'cloudRetry',
      text: 'Облачные функции Тапёра не отвечали — Тапёр переподключил' }
  ],
  lastfm: [
    { id: 'lastfm-retry', name: 'повтор запроса', kind: 'check', heavy: false, run: 'lastfmRetry',
      text: 'Last.fm не отвечал — Тапёр переподключил' }
  ],
  // Twitch: пак не даёт переподключить чат/оверлей без его правки — автоматической
  // починки нет. GitHub (сайт-визитка) на ходу не ломается — тоже нет.
  twitch: [],
  github: []
};

// Что из быстрой проверки в какую починку. Быстрая проверка — готовый вердикт,
// поэтому порог всегда 1. onlyAction — брать пункт, только если кнопка именно такая
// (у сайта Яндекса «войти на сайте» — это не поломка, а отсутствие входа).
const QUICK_MAP = {
  'ym.svc': { service: 'yandex', kind: 'service', states: ['bad'] },
  'ym.acc': { service: 'yandex', kind: 'login', states: ['bad'], authOn: 'ym-login' },
  'ym.play': { service: 'yandex', kind: 'stream', states: ['bad'] },
  'ym.site': { service: 'yandex', kind: 'site', states: ['bad', 'warn'], onlyAction: 'fix' },
  'yt.svc': { service: 'youtube', kind: 'service', states: ['bad'] },
  'yt.login': { service: 'youtube', kind: 'login', states: ['bad'], authOn: 'yt-login' },
  'yt.dlp': { service: 'youtube', kind: 'engine', states: ['bad', 'warn'] },
  cloud: { service: 'cloud', kind: 'check', states: ['bad'] }
};

// Что делать владельцу, если починка не вышла (показывается в чеклисте).
const HELP = {
  youtube: 'YouTube не отвечает или движок устарел. Нажми «Починить»; если не поможет — проверь VPN: без него YouTube часто недоступен.',
  yandex: 'Яндекс не отвечает. Нажми «Починить»; если не поможет — подожди, скорее всего это у Яндекса.',
  donationalerts: 'DonationAlerts не отвечает. Нажми «Починить»; если не поможет — проверь вход в сервис в «Стримерам».',
  donatepay: 'DonatePay не отвечает. Нажми «Починить»; если не поможет — проверь вход в сервис в «Стримерам».',
  cloud: 'Облачные функции Тапёра не отвечают: вход и отчёты могут не работать. Нажми «Починить»; если не поможет — смотри подсказку в строке «Облачные функции».',
  lastfm: 'Last.fm не отвечает — описания и похожие могут не грузиться. Нажми «Починить».',
  twitch: 'Twitch чинится только в паке стримера — автоматически Тапёр его не трогает.',
  github: 'GitHub нужен для сайта-визитки. Проверь вход и повтори вручную.'
};

function isService(s) { return Object.prototype.hasOwnProperty.call(REPAIRS, String(s)); }
function isKind(s, kind) {
  return (REPAIRS[String(s)] || []).some((r) => r.kind === kind || (r.kinds || []).indexOf(kind) >= 0);
}
function thresholdFor(service, kind) {
  const t = THRESHOLDS[service] || {};
  const n = t[kind];
  return n == null ? 1 : Number(n) || 1;
}

// Пункты быстрой проверки → цели починки. Без состояния: чистая функция, удобна для тестов.
function quickTargets(items) {
  const out = [];
  if (!items || typeof items !== 'object') return out;
  Object.keys(QUICK_MAP).forEach((id) => {
    const it = items[id];
    if (!it) return;
    const m = QUICK_MAP[id];
    if ((m.states || ['bad']).indexOf(it.state) < 0) return;
    if (m.onlyAction && it.action !== m.onlyAction) return;
    out.push({ service: m.service, kind: m.kind, reason: it.text || '', auth: !!m.authOn && it.action === m.authOn });
  });
  return out;
}

function short(e) {
  const s = String((e && e.message) || e || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'неизвестная ошибка';
  // Владельцу — простыми словами, а не «fetch failed» и стеком.
  if (/fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network|socket hang up/i.test(s)) return 'нет связи';
  if (/timeout|timed out|не ответил за/i.test(s)) return 'не ответили вовремя';
  if (/HTTP 5\d\d|service unavailable|сервис недоступен/i.test(s)) return 'сервис не отвечает';
  return s.slice(0, 120);
}

function withTimeout(p, ms) {
  if (!ms || ms <= 0) return Promise.resolve(p);
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('не ответил за ' + Math.round(ms / 1000) + ' с'));
    }, ms);
    Promise.resolve(p).then((v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(v);
    }, (e) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(e);
    });
  });
}

function create(opts) {
  const o = opts || {};
  const repairs = o.repairs || REPAIRS;
  const handlers = o.handlers || {};
  const isBusy = typeof o.isBusy === 'function' ? o.isBusy : () => false;
  const log = typeof o.log === 'function' ? o.log : () => {};
  const toast = typeof o.toast === 'function' ? o.toast : () => {};
  const record = typeof o.record === 'function' ? o.record : () => {};
  const onChange = typeof o.onChange === 'function' ? o.onChange : () => {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const heavyTimeoutMs = Number(o.heavyTimeoutMs) > 0 ? Number(o.heavyTimeoutMs) : 180000;
  const lightTimeoutMs = Number(o.lightTimeoutMs) > 0 ? Number(o.lightTimeoutMs) : 45000;

  const state = Object.create(null);   // служба → { state, repair, reason, at, heavy, text }
  const tried = Object.create(null);   // служба → true после первой попытки
  const pending = Object.create(null); // служба → { repair, kind } — тяжёлая ждёт паузы
  const streaks = Object.create(null); // 'служба|вид' → ошибок подряд
  const last = Object.create(null);    // служба → { kind, repairId } — для ручного «Починить»
  const running = Object.create(null); // служба → Promise текущей починки
  const waitAsked = Object.create(null);
  let suspended = false;

  function emit() {
    try { onChange(snapshot()); } catch (e) { /* интерфейс не должен ронять починку */ }
  }

  function nameOf(service) { return NAMES[service] || String(service || 'сервис'); }
  function keyOf(service, kind) { return String(service) + '|' + String(kind); }

  function resolveStep(step) {
    if (typeof step === 'function') return step;
    const f = handlers[step];
    if (typeof f !== 'function') throw new Error('нет обработчика «' + step + '»');
    return f;
  }

  function findRepair(service, kind) {
    return (repairs[service] || []).find((r) => r.kind === kind || (r.kinds || []).indexOf(kind) >= 0) || null;
  }

  function snapshot() {
    const out = {};
    Object.keys(state).forEach((s) => {
      const st = state[s];
      out[s] = {
        state: st.state,
        name: nameOf(s),
        repair: st.repair || '',
        reason: st.reason || '',
        text: st.text || '',
        at: st.at || 0,
        heavy: !!st.heavy
      };
    });
    return out;
  }

  function setState(service, patch) {
    state[service] = Object.assign({ at: now() }, patch || {});
    emit();
  }

  // Запуск одной починки. Возвращает обещание результата.
  function runRepair(service, rep, kind) {
    tried[service] = true;
    delete pending[service];
    setState(service, { state: 'чинит', repair: rep.id, reason: '', heavy: !!rep.heavy, text: '' });
    const ms = rep.heavy ? heavyTimeoutMs : lightTimeoutMs;
    let res = null;
    // A11: музыка могла заиграть уже после trigger(). Перед КАЖДЫМ шагом тяжёлой
    // починки проверяем занятость: если играет — шаг не начинаем, починка снова ждёт
    // паузы (и «один раз» снимаем: попытки-то ещё не было).
    const holdIfBusy = () => {
      if (!(rep.heavy && isBusy())) return false;
      tried[service] = false;
      pending[service] = { repair: rep, kind };
      setState(service, { state: 'ждёт', repair: rep.id, reason: '', heavy: true, text: '' });
      log('авточинка: ' + nameOf(service) + ' ' + rep.name + ' → музыка снова играет, ждёт паузы');
      if (!waitAsked[service]) {
        waitAsked[service] = true;
        toast(rep.wait || 'Жду паузы, чтобы починить сервис');
      }
      return true;
    };
    const job = (async () => {
      try {
        if (holdIfBusy()) return { action: 'waiting' };
        res = await withTimeout(Promise.resolve().then(() => resolveStep(rep.run)(service, kind)), ms);
        if (res === false) throw new Error('не получилось');
        if (res && res.ok === false) throw new Error((res && (res.reason || res.text)) || 'не получилось');
        if (rep.verify) {
          if (holdIfBusy()) return { action: 'waiting' };
          const v = await withTimeout(Promise.resolve().then(() => resolveStep(rep.verify)(service, kind, res)), ms);
          if (v === false || (v && v.ok === false)) throw new Error((v && (v.reason || v.text)) || 'проверка не прошла');
        }
      } catch (e) {
        const reason = short(e);
        setState(service, { state: 'не вышло', repair: rep.id, reason, heavy: !!rep.heavy, text: '' });
        record(service, false);
        log('авточинка: ' + nameOf(service) + ' ' + rep.name + ' → не вышло (' + reason + ')');
        toast(nameOf(service) + ': починить не получилось — подсказка в «Быстрой проверке»');
        return { action: 'failed', ok: false, reason };
      }
      streaks[keyOf(service, kind)] = 0;
      const text = (res && res.text) || rep.text || (nameOf(service) + ' — починено');
      setState(service, { state: 'починено', repair: rep.id, reason: '', heavy: !!rep.heavy, text });
      record(service, true);
      log('авточинка: ' + nameOf(service) + ' ' + rep.name + ' → ок');
      toast(text);
      return { action: 'fixed', ok: true, text };
    })();
    running[service] = job;
    job.then(() => {
      if (running[service] === job) delete running[service];
      tick();
    }, () => {
      if (running[service] === job) delete running[service];
      tick();
    });
    return job;
  }

  function trigger(service, kind, how) {
    const manual = !!(how && how.manual);
    if (suspended) return Promise.resolve({ action: 'suspended' });
    if (!isService(service)) return Promise.resolve({ action: 'none' });
    if (running[service]) return Promise.resolve({ action: 'busy' });
    if (!manual && tried[service]) return Promise.resolve({ action: 'skipped' });
    const rep = findRepair(service, kind);
    if (!rep) return Promise.resolve({ action: 'none' });
    last[service] = { kind, repairId: rep.id };
    if (pending[service]) return Promise.resolve({ action: 'waiting' });
    if (rep.heavy && isBusy()) {
      pending[service] = { repair: rep, kind };
      setState(service, { state: 'ждёт', repair: rep.id, reason: '', heavy: true, text: '' });
      if (!waitAsked[service]) {
        waitAsked[service] = true;
        log('авточинка: ' + nameOf(service) + ' ' + rep.name + ' → ждёт паузы');
        toast(rep.wait || 'Жду паузы, чтобы починить сервис');
      }
      return Promise.resolve({ action: 'waiting' });
    }
    return runRepair(service, rep, kind);
  }

  // Ошибка во время работы. Считаем «подряд»; на пороге — одна попытка починки.
  function note(service, kind, info) {
    const svc = String(service || '');
    if (!isService(svc)) return Promise.resolve({ action: 'none' });
    const k = keyOf(svc, kind);
    const force = !!(info && info.force);
    const need = force ? 1 : thresholdFor(svc, kind);
    streaks[k] = (Number(streaks[k]) || 0) + 1;
    if (!force && streaks[k] < need) return Promise.resolve({ action: 'wait', count: streaks[k], need });
    if (suspended) return Promise.resolve({ action: 'suspended' });
    return trigger(svc, kind, { reason: (info && info.reason) || '' });
  }

  // Успех источника — счётчик «подряд» сбрасываем. Если служба была «нужен вход»,
  // а вход снова работает — снимаем отметку и разрешаем автопочинку впредь.
  function success(service, kind) {
    const svc = String(service || '');
    if (!isService(svc)) return;
    streaks[keyOf(svc, kind)] = 0;
    const st = state[svc];
    if (st && st.state === 'нужен вход' && (kind === 'login' || kind === 'poll' || kind === 'service')) {
      delete state[svc];
      tried[svc] = false;
      emit();
    }
  }

  // «Вход отозван»: сами не чиним — показываем и ждём, когда владелец войдёт заново.
  function auth(service, reason) {
    const svc = String(service || '');
    if (!isService(svc)) return Promise.resolve({ action: 'none' });
    delete pending[svc];
    tried[svc] = true;
    const text = reason || 'вход отозван — войдите заново';
    setState(svc, { state: 'нужен вход', repair: '', reason: text, heavy: false, text });
    log('авточинка: ' + nameOf(svc) + ' вход отозван — не чиню, нужно войти заново');
    toast(nameOf(svc) + ': вход отозван — войдите заново');
    return Promise.resolve({ action: 'auth' });
  }

  // Итог быстрой проверки: каждая проблемная строка — повод для одной попытки.
  // extra — то, что главный процесс добавляет сам (донаты по провайдерам, Last.fm).
  async function check(items, extra) {
    const list = quickTargets(items).concat(Array.isArray(extra) ? extra : []);
    const out = [];
    for (const t of list) {
      if (!t || !isService(t.service)) continue;
      if (t.auth) out.push(await auth(t.service, t.reason));
      else out.push(await note(t.service, t.kind, { force: true, reason: t.reason }));
    }
    return out;
  }

  // Ручное «Починить» для службы: снимает отметку «один раз» и повторяет её починку.
  function manual(service) {
    const svc = String(service || '');
    if (!isService(svc)) return Promise.resolve({ action: 'none' });
    if (running[svc]) return Promise.resolve({ action: 'busy' });
    const info = last[svc];
    if (!info) return Promise.resolve({ action: 'none' });
    delete tried[svc];
    delete pending[svc];
    waitAsked[svc] = false;
    return trigger(svc, info.kind, { manual: true });
  }

  // Ручная «Починить автоматически» (все починки): пока идёт, свои попытки не запускаем,
  // а отметки «один раз» снимаем в начале и в конце.
  function beginManual() {
    suspended = true;
    clearMarks();
  }
  function endManual() {
    suspended = false;
    clearMarks();
  }
  function clearMarks() {
    Object.keys(tried).forEach((s) => { if (!running[s]) { delete tried[s]; delete pending[s]; delete state[s]; waitAsked[s] = false; } });
    emit();
  }

  // Пришла пауза: если музыка не играет — запускаем отложенные тяжёлые починки по одной.
  function tick() {
    if (suspended || isBusy()) return;
    const svc = Object.keys(pending).find((s) => !running[s] && pending[s]);
    if (!svc) return;
    const p = pending[svc];
    delete pending[svc];
    if (tried[svc]) { emit(); tick(); return; }
    runRepair(svc, p.repair, p.kind);
  }

  // Дождаться, пока закончатся все запущенные починки (для тестов и аккуратного выхода).
  function idle() {
    const list = Object.keys(running).map((s) => running[s]);
    if (!list.length) return Promise.resolve();
    return Promise.all(list).then(() => idle());
  }

  return {
    note, success, auth, check, manual, beginManual, endManual, tick, idle, snapshot,
    isTried: (s) => !!tried[s],
    isSuspended: () => suspended,
    pending: () => Object.keys(pending),
    _test: { state, tried, pending, streaks, last, running }
  };
}

module.exports = {
  NAMES, THRESHOLDS, REPAIRS, QUICK_MAP, HELP,
  isService, isKind, thresholdFor, quickTargets, create
};
