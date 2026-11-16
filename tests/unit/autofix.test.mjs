import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const autofix = require('../../src/autofix.js');

// Стенд: свои починки и обработчики, чтобы не трогать сеть, диск и electron.
function stand(opts = {}) {
  const calls = [];
  const toasts = [];
  const records = [];
  const gates = {};
  let busy = !!opts.busy;
  let t = 1000;
  const repairs = {
    youtube: [
      {
        id: 'light', name: 'переподключение', kind: 'service', heavy: false, text: 'YouTube отвалился — Тапёр переподключил',
        run: async () => { calls.push('light'); return { ok: true }; },
        verify: async () => true
      },
      {
        id: 'heavy', name: 'обновление движка', kind: 'engine', heavy: true, text: 'Движок обновлён',
        wait: 'Жду паузы, чтобы обновить движок YouTube',
        run: async () => { calls.push('heavy'); return { ok: true }; },
        verify: async () => true
      },
      {
        id: 'fail', name: 'сломанная', kind: 'stream', heavy: false,
        run: async () => { calls.push('fail'); return { ok: false, reason: 'нет связи' }; }
      },
      {
        id: 'bad-verify', name: 'проверка не прошла', kind: 'login', heavy: false,
        run: async () => { calls.push('bad-verify'); return { ok: true }; },
        verify: async () => false
      },
      {
        id: 'gated', name: 'долгая', kind: 'rules', heavy: false,
        run: async () => { calls.push('gated'); await gates.go; return { ok: true }; }
      }
    ],
    yandex: [
      { id: 'svc', name: 'переподключение', kind: 'service', heavy: false, text: 'Яндекс переподключён',
        run: async () => { calls.push('ysvc'); return { ok: true }; } },
      { id: 'api', name: 'переподключение', kind: 'api', heavy: false, text: 'Яндекс переподключён',
        run: async () => { calls.push('api'); return { ok: true }; } }
    ],
    donationalerts: [
      { id: 'don', name: 'переподключение', kind: 'poll', heavy: false, text: 'DonationAlerts переподключён',
        run: async () => { calls.push('don'); return { ok: true }; } }
    ],
    cloud: [
      { id: 'cloud', name: 'повтор проверки', kind: 'check', heavy: false, text: 'Облако переподключено',
        run: async () => { calls.push('cloud'); return { ok: true }; } }
    ]
  };
  const a = autofix.create({
    repairs,
    isBusy: () => busy,
    now: () => (t += 10),
    log: () => {},
    toast: (m) => toasts.push(m),
    record: (s, ok) => records.push([s, ok]),
    onChange: () => {}
  });
  return {
    a, calls, toasts, records,
    setBusy: (v) => { busy = !!v; },
    gate: (p) => { gates.go = p; }
  };
}

test('автопочинка: «один раз» — вторая поломка того же сервиса без ручного нажатия не чинится', async () => {
  const s = stand();
  const first = await s.a.note('youtube', 'service', { reason: 'не отвечает' });
  assert.equal(first.action, 'fixed');
  assert.deepEqual(s.calls, ['light']);
  const second = await s.a.note('youtube', 'service', { reason: 'снова не отвечает' });
  assert.equal(second.action, 'skipped');
  assert.deepEqual(s.calls, ['light'], 'вторая попытка без «Починить» не запускается');
  assert.equal(s.a.isTried('youtube'), true);
});

test('автопочинка: тяжёлая ждёт, пока музыка не играет, и запускается на паузе', async () => {
  const s = stand({ busy: true });
  const r = await s.a.note('youtube', 'engine', { reason: 'движок устарел' });
  assert.equal(r.action, 'waiting');
  assert.deepEqual(s.calls, [], 'во время игры тяжёлую не запускаем');
  assert.deepEqual(s.a.pending(), ['youtube']);
  assert.match(s.toasts[0], /Жду паузы/);
  assert.equal(s.a.snapshot().youtube.state, 'ждёт');
  // Вторая поломка, пока ждём, не плодит сообщений и попыток.
  await s.a.note('youtube', 'service', { reason: 'ещё одна' });
  assert.equal(s.toasts.filter((x) => /Жду паузы/.test(x)).length, 1, '«Жду паузы» — один раз');
  assert.deepEqual(s.calls, []);
  // Наступила пауза.
  s.setBusy(false);
  s.a.tick();
  await s.a.idle();
  assert.deepEqual(s.calls, ['heavy']);
  assert.deepEqual(s.records, [['youtube', true]]);
  assert.equal(s.a.snapshot().youtube.state, 'починено');
});

test('автопочинка: «вход отозван» не чиним, а показываем «войдите заново»', async () => {
  const s = stand();
  const r = await s.a.auth('donationalerts', 'вход отозван — войдите заново');
  assert.equal(r.action, 'auth');
  assert.deepEqual(s.calls, []);
  const st = s.a.snapshot().donationalerts;
  assert.equal(st.state, 'нужен вход');
  assert.match(st.reason, /войдите заново/);
  assert.match(s.toasts[0], /войдите заново/);
  assert.equal(s.a.isTried('donationalerts'), true);
});

test('автопочинка: ручное «Починить» снимает отметку «один раз» и повторяет починку', async () => {
  const s = stand();
  await s.a.note('youtube', 'service', { reason: 'не отвечает' });
  assert.deepEqual(s.calls, ['light']);
  const again = await s.a.note('youtube', 'service', { reason: 'не отвечает' });
  assert.equal(again.action, 'skipped');
  const m = await s.a.manual('youtube');
  assert.equal(m.action, 'fixed');
  assert.deepEqual(s.calls, ['light', 'light'], 'ручное нажатие снова запускает починку');
  assert.deepEqual(s.records, [['youtube', true], ['youtube', true]]);
});

test('автопочинка: порог «подряд» и сброс при успехе', async () => {
  const s = stand();
  let r = await s.a.note('yandex', 'api', { reason: 'сеть' });
  assert.equal(r.action, 'wait');
  r = await s.a.note('yandex', 'api', { reason: 'сеть' });
  assert.equal(r.action, 'wait');
  assert.deepEqual(s.calls, [], 'два раза подряд — ещё рано');
  r = await s.a.note('yandex', 'api', { reason: 'сеть' });
  assert.equal(r.action, 'fixed');
  assert.deepEqual(s.calls, ['api']);
  // Другой вид — свой счётчик; проверим сброс на уже сработавшем api вручную:
  const s2 = stand();
  await s2.a.note('yandex', 'api', { reason: 'сеть' });
  await s2.a.note('yandex', 'api', { reason: 'сеть' });
  s2.a.success('yandex', 'api');
  let q = await s2.a.note('yandex', 'api', { reason: 'сеть' });
  assert.equal(q.action, 'wait', 'после успеха счётчик начался заново');
  q = await s2.a.note('yandex', 'api', { reason: 'сеть' });
  assert.equal(q.action, 'wait');
  q = await s2.a.note('yandex', 'api', { reason: 'сеть' });
  assert.equal(q.action, 'fixed');
});

test('автопочинка: счётчики — отдельно успешные и неуспешные', async () => {
  const s = stand();
  // Поток YouTube — порог «подряд» 2.
  await s.a.note('youtube', 'stream', { reason: 'поток' });
  await s.a.note('youtube', 'stream', { reason: 'поток' });
  assert.deepEqual(s.records, [['youtube', false]]);
  const st = s.a.snapshot().youtube;
  assert.equal(st.state, 'не вышло');
  assert.match(st.reason, /нет связи/);
  assert.match(s.toasts[0], /починить не получилось/);
  assert.equal(s.a.isTried('youtube'), true);
  // Вторая попытка — только по кнопке.
  await s.a.manual('youtube');
  assert.deepEqual(s.records, [['youtube', false], ['youtube', false]]);
});

test('автопочинка: проверка не прошла — считаем «не вышло»', async () => {
  const s = stand();
  await s.a.note('youtube', 'login', { reason: 'вход' });
  assert.deepEqual(s.calls, ['bad-verify']);
  assert.equal(s.a.snapshot().youtube.state, 'не вышло');
  assert.deepEqual(s.records, [['youtube', false]]);
});

test('автопочинка: две починки одного сервиса сразу не запускаются', async () => {
  const s = stand();
  let release;
  s.gate(new Promise((r) => { release = r; }));
  const first = s.a.note('youtube', 'rules', { reason: 'правила' });
  const second = await s.a.note('youtube', 'service', { reason: 'сервис' });
  assert.equal(second.action, 'busy');
  assert.equal(s.calls.length, 1);
  release();
  await first;
  await s.a.idle();
  assert.deepEqual(s.calls, ['gated']);
});

test('автопочинка: нет починки под такой вид проблемы — молчим, попытки нет', async () => {
  const s = stand();
  const r = await s.a.note('yandex', 'unknown', { reason: 'что-то' });
  assert.equal(r.action, 'none');
  assert.deepEqual(s.calls, []);
  assert.deepEqual(s.a.pending(), []);
});

test('автопочинка: быстрая проверка — ready targets, «войти» не чиним, off пропускаем', async () => {
  const items = {
    'ym.svc': { state: 'bad', text: 'не отвечает' },
    'ym.acc': { state: 'bad', text: 'вход устарел', action: 'ym-login' },
    'ym.site': { state: 'warn', text: 'старый вердикт', action: 'ym-site-login' },
    'yt.dlp': { state: 'warn', text: 'есть новее' },
    'yt.svc': { state: 'off', text: 'выключен' },
    net: { state: 'ok', text: 'есть' }
  };
  const targets = autofix.quickTargets(items);
  const kinds = targets.map((x) => x.service + ':' + x.kind);
  assert.deepEqual(kinds, ['yandex:service', 'yandex:login', 'youtube:engine']);
  assert.equal(targets.find((x) => x.kind === 'login').auth, true, 'вход отозван — это auth, а не починка');
  const s = stand();
  const out = await s.a.check(items);
  const actions = out.map((x) => x.action);
  assert.ok(actions.indexOf('auth') >= 0);
  assert.ok(actions.indexOf('fixed') >= 0);
  assert.ok(s.calls.indexOf('ysvc') >= 0);
  assert.ok(s.calls.indexOf('heavy') >= 0);
});

test('автопочинка: ручная «Починить автоматически» не даёт автопопыткам запуститься', async () => {
  const s = stand();
  s.a.beginManual();
  const r = await s.a.note('youtube', 'service', { force: true, reason: 'не отвечает' });
  assert.equal(r.action, 'suspended');
  assert.deepEqual(s.calls, []);
  s.a.endManual();
  assert.equal(s.a.isSuspended(), false);
  const r2 = await s.a.note('youtube', 'service', { force: true, reason: 'не отвечает' });
  assert.equal(r2.action, 'fixed');
});

test('автопочинка: после успеха службу чинит только ручное нажатие, но не сам Тапёр', async () => {
  const s = stand();
  await s.a.note('yandex', 'api', { reason: 'сеть' });
  await s.a.note('yandex', 'api', { reason: 'сеть' });
  await s.a.note('yandex', 'api', { reason: 'сеть' });
  assert.deepEqual(s.calls, ['api']);
  s.a.success('yandex', 'api');
  // Порог сброшен: следующие ошибки снова копятся. Отметка «один раз» осталась —
  // даже набрав порог, без кнопки починка не запускается.
  await s.a.note('yandex', 'api', { reason: 'сеть' });
  await s.a.note('yandex', 'api', { reason: 'сеть' });
  const r = await s.a.note('yandex', 'api', { reason: 'сеть' });
  assert.equal(r.action, 'skipped');
  assert.deepEqual(s.calls, ['api']);
});

// A11: музыка может заиграть уже после старта тяжёлой починки. Тогда следующий шаг
// не начинаем, а починка возвращается в «ждёт» и повторится на паузе (не «один раз»).
test('A11: музыка заиграла посреди тяжёлой починки — проверка не запускается, починка снова ждёт', async () => {
  const calls = [];
  let busy = false;
  let phase = 0;
  const a = autofix.create({
    repairs: {
      youtube: [{
        id: 'heavy', name: 'обновление движка', kind: 'engine', heavy: true, text: 'Движок обновлён',
        wait: 'Жду паузы, чтобы обновить движок YouTube',
        run: async () => { calls.push('run'); if (phase === 0) { phase = 1; busy = true; } return { ok: true }; },
        verify: async () => { calls.push('verify'); return { ok: true }; },
      }],
    },
    isBusy: () => busy,
    now: () => 1,
    log: () => {}, toast: () => {}, record: () => {}, onChange: () => {},
  });
  const r = await a.note('youtube', 'engine', { force: true, reason: 'движок устарел' });
  assert.equal(r.action, 'waiting');
  assert.deepEqual(calls, ['run'], 'проверка не должна запускаться, когда музыка уже играет');
  assert.equal(a.snapshot().youtube.state, 'ждёт');
  assert.deepEqual(a.pending(), ['youtube']);
  assert.equal(a.isTried('youtube'), false, 'попытки ещё не было — на паузе можно снова');

  // Пауза: шаг проходит целиком, включая проверку.
  busy = false;
  a.tick();
  await a.idle();
  assert.deepEqual(calls, ['run', 'run', 'verify']);
  assert.equal(a.snapshot().youtube.state, 'починено');
  assert.deepEqual(a.pending(), []);
});

test('A11: если музыка заиграла до первого шага — тяжёлая починка не начинается вовсе', async () => {
  const calls = [];
  let checks = 0;
  const a = autofix.create({
    repairs: {
      youtube: [{ id: 'heavy', name: 'обновление движка', kind: 'engine', heavy: true,
        run: async () => { calls.push('run'); return { ok: true }; } }],
    },
    // trigger спрашивает один раз (ещё тихо), а перед шагом — уже играет.
    isBusy: () => { checks += 1; return checks > 1; },
    now: () => 1,
    log: () => {}, toast: () => {}, record: () => {}, onChange: () => {},
  });
  const r = await a.note('youtube', 'engine', { force: true, reason: 'движок' });
  assert.equal(r.action, 'waiting');
  assert.deepEqual(calls, [], 'шаг не начали');
  assert.equal(a.snapshot().youtube.state, 'ждёт');
  assert.deepEqual(a.pending(), ['youtube']);
});
