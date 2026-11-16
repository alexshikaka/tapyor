// Fault injection без Electron и сети: ломаем зависимости Pipeline и проверяем,
// что заказ не зависает, не роняет процесс и заканчивается понятным исходом.
//
// Запуск: node tools/reliability/fault.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// D2 (F2): как и soak, fault проверяет Pipeline из пака стримера. В открытом снимке папки
// modules/streamer-pack/ нет — это пропуск с причиной, а не падение на MODULE_NOT_FOUND.
const PACK_LOGIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'modules', 'streamer-pack', 'bot', 'src', 'logic');
if (!fs.existsSync(path.join(PACK_LOGIC, 'pipeline.js'))) {
  console.log('FAULT_SKIP: нет modules/streamer-pack/ — пак не входит в открытый снимок');
  process.exit(0);
}
const { Pipeline } = require('../../modules/streamer-pack/bot/src/logic/pipeline.js');
const { Limiter } = require('../../modules/streamer-pack/bot/src/logic/limiter.js');
const { preset } = require('../../modules/streamer-pack/bot/src/logic/access.js');
const req = require('../../src/reqparse.js');
const store = require('../../src/settings-store.js');

const USER = { id: 'u1', login: 'tester', isBroadcaster: false, isMod: false, isVip: false, isSub: false, followedAt: null };
const KINO = { src: 'ym', id: '1', author: 'Кино', title: 'Группа крови', seconds: 200 };

function core(overrides = {}) {
  return {
    added: [],
    findOrder: async () => ({ level: 'exact', track: KINO }),
    checkTrack: () => ({ ok: true }),
    orders: {
      add(o) { this.added.push(o); return { id: 'o' + this.added.length, place: this.added.length, etaSec: 200 }; },
      count() { return 0; },
      remove() {}
    },
    settings: { get: () => ({}), set: () => {} },
    log() {},
    ...overrides
  };
}

async function run(msg, opts = {}, overrides = {}) {
  const c = core(overrides);
  const p = new Pipeline({
    access: preset('always'), triggers: ['!play'], queueCap: 10, limitsFromQueue: 0,
    ...opts
  }, { core: c, now: () => 1_700_000_000_000, rnd: () => 0.5, say: async () => {}, limiter: opts.limiter });
  p.setOnline(true);
  return { p, c, out: await p.handle({ id: 'm1', at: 1_700_000_000_000, text: msg, own: true, user: USER }) };
}

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
}

// 1. Источник падает исключением — Pipeline не должен зависнуть.
{
  const { out } = await run('!play кино группа крови', {}, {
    findOrder: async () => { throw new Error('injected network failure'); }
  });
  check('сбой источника → notFound, не зависание', () => assert.equal(out, 'notFound'));
}

// 2. Источник не отвечает — Limiter обязан вернуть timeout, Pipeline — notFound.
{
  const started = Date.now();
  const { out } = await run('!play кино группа крови', { limiter: new Limiter(1, 50) }, {
    findOrder: () => new Promise(() => {})
  });
  const ms = Date.now() - started;
  check('таймаут источника → notFound за <500 мс', () => {
    assert.equal(out, 'notFound');
    assert.ok(ms < 500, 'заняло ' + ms + ' мс');
  });
}

// 3. Ошибка записи заказа — outcome error, без падения и unhandled rejection.
{
  const { out, c } = await run('!play кино группа крови', {}, {
    orders: {
      add() { throw new Error('injected orders.add failure'); },
      count() { return 0; }, remove() {}
    }
  });
  check('ошибка orders.add → error, очередь не тронута', () => {
    assert.equal(out, 'error');
    assert.equal(c.added.length, 0);
  });
}

// 4. Битый ответ источника (exact без track) не должен ронять Pipeline.
{
  const { out } = await run('!play кино группа крови', {}, {
    findOrder: async () => ({ level: 'exact', track: null })
  });
  check('exact без track → безопасный исход', () => assert.ok(['notFound', 'error', 'rules'].includes(out), 'out=' + out));
}

// 5. Случайный мусор в парсере не бросает исключение.
check('reqparse: мусор не бросает', () => {
  for (let i = 0; i < 500; i++) {
    const s = ['\u0000', '🎵', '—', 'https://', '!play', 'null', '[]', '漢'].join('').repeat(i % 7);
    assert.doesNotThrow(() => req.plan(s));
    assert.doesNotThrow(() => req.judge(s, { title: s, author: '' }));
  }
});

// 6. Битые настройки: null/[]/число не должны приниматься как объект.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-fault-'));
  const file = path.join(dir, 'settings.json');
  try {
    for (const bad of ['null', '[]', '42', '"x"', '{broken']) {
      fs.writeFileSync(file, bad, 'utf8');
      store.setup({ file });
      const all = store.all();
      assert.ok(all && typeof all === 'object' && !Array.isArray(all), 'bad=' + bad);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  check('битые настройки → объект', () => {});
}

for (const r of results) {
  console.log((r.ok ? 'ok ' : 'FAIL ') + r.name + (r.ok ? '' : ' — ' + r.error));
}
const failed = results.filter((r) => !r.ok);
if (failed.length) process.exitCode = 1;
else console.log('fault injection: ' + results.length + '/' + results.length);
