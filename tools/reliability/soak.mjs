// Длительный прогон очереди/лимитера бота без Electron и сети.
// Это не аудио-soak, а проверка, что Pipeline не залипает, не течёт и не копит pending.
//
// Запуск: node tools/reliability/soak.mjs --hours 2
// Короткий прогон: node tools/reliability/soak.mjs --minutes 2 --virtual
// --minutes важнее --hours; --out <путь> — куда писать отчёт (по умолчанию tools/reliability/soak-result.json).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// D2 (F2): soak проверяет Pipeline из пака стримера, а папки modules/streamer-pack/ в открытом
// снимке нет. Это не ошибка прогона, а пропуск — говорим об этом прямо и выходим без падения.
const PACK_LOGIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'modules', 'streamer-pack', 'bot', 'src', 'logic');
if (!fs.existsSync(path.join(PACK_LOGIC, 'pipeline.js'))) {
  console.log('SOAK_SKIP: нет modules/streamer-pack/ — пак не входит в открытый снимок');
  process.exit(0);
}
const { Pipeline } = require('../../modules/streamer-pack/bot/src/logic/pipeline.js');
const { Limiter } = require('../../modules/streamer-pack/bot/src/logic/limiter.js');
const { preset } = require('../../modules/streamer-pack/bot/src/logic/access.js');

const args = process.argv.slice(2);
const minutesArg = args.indexOf('--minutes');
const MINUTES = minutesArg >= 0 ? Math.max(0.01, Number(args[minutesArg + 1]) || 2) : null;
const hoursArg = args.indexOf('--hours');
const HOURS = MINUTES !== null ? MINUTES / 60 : (hoursArg >= 0 ? Math.max(0.01, Number(args[hoursArg + 1]) || 2) : 2);
const VIRTUAL = args.includes('--virtual');
const DURATION = MINUTES !== null ? MINUTES * 60 * 1000 : HOURS * 3600 * 1000;
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 && args[outArg + 1] ? path.resolve(args[outArg + 1]) : path.join(process.cwd(), 'tools/reliability/soak-result.json');
const CAP = 10;
// И виртуальные часы, и отсчёт длительности идут от одной точки — реального старта.
const realStart = Date.now();
let virtualNow = realStart;
const now = () => VIRTUAL ? virtualNow : Date.now();

const users = Array.from({ length: 200 }, (_, i) => ({
  id: 'u' + i, login: 'user' + i, isBroadcaster: false, isMod: false, isVip: false, isSub: false, followedAt: null
}));
const texts = ['!play кино группа крови', '!play ария беспечный ангел', '!play несуществующий трек', '!play', '!play кино'];
const tracks = [
  { src: 'ym', id: '1', author: 'Кино', title: 'Группа крови', seconds: 200 },
  { src: 'ym', id: '2', author: 'Ария', title: 'Беспечный ангел', seconds: 300 },
  { src: 'yt', id: '3', author: 'Кино', title: 'Кукушка', seconds: 250 }
];
const queue = [];
let seq = 0;
const core = {
  findOrder: async (q) => {
    const bad = Math.random();
    if (bad < 0.04) throw new Error('injected network failure');
    if (bad < 0.06) await new Promise((r) => setTimeout(r, VIRTUAL ? 1 : 300));
    if (/несуществующий/.test(q)) return { level: 'none' };
    if (bad < 0.1) return { level: 'doubt', track: tracks[1], alts: [tracks[2]] };
    return { level: 'exact', track: tracks[Math.floor(Math.random() * tracks.length)] };
  },
  checkTrack: () => ({ ok: true }),
  orders: {
    add(o) {
      const id = 'o' + (++seq);
      queue.push({ id, ...o });
      return { id, place: queue.length, etaSec: queue.length * 200 };
    },
    count(prov) {
      if (prov === 'any') return queue.length;
      return queue.filter((x) => x.prov === prov).length;
    },
    remove(id) { const i = queue.findIndex((x) => x.id === id); if (i >= 0) queue.splice(i, 1); }
  },
  settings: { get: () => ({}), set: () => {} },
  log: () => {}
};

const access = preset('always');
for (const k of Object.keys(access)) { access[k].pauseMin = 0; access[k].active = 2; }
const p = new Pipeline({
  access, triggers: ['!play'], queueCap: CAP, limitsFromQueue: 0,
  approval: 'auto', onlyLive: true
}, { core, now, rnd: Math.random, say: async () => {}, limiter: new Limiter(3, 120) });
p.setOnline(true);

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });
const start = now();
const mem0 = process.memoryUsage().rss;
let n = 0, changed = 0, lastLog = start;
const outcomes = Object.create(null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mem = () => process.memoryUsage().rss;

while (now() - start < DURATION) {
  const u = users[Math.floor(Math.random() * users.length)];
  const text = texts[Math.floor(Math.random() * texts.length)];
  const out = await p.handle({ id: 'm' + n, at: now(), text, own: true, user: u });
  outcomes[out] = (outcomes[out] || 0) + 1;
  n++;
  // Иногда стример снимает/проигрывает заказ — очередь не должна расти бесконечно.
  if (queue.length && Math.random() < 0.10) {
    const i = Math.floor(Math.random() * queue.length);
    const id = queue[i].id;
    if (Math.random() < 0.5) { p.orderPlayed(id); changed++; }
    else { p.orderDropped(id); changed++; }
    core.orders.remove(id);
  }
  if (now() - lastLog >= 60000) {
    lastLog = now();
    const elapsed = ((now() - start) / 60000).toFixed(1);
    console.log(`soak ${elapsed} мин · команд ${n} · очередь ${queue.length} · RSS ${Math.round(mem() / 1048576)} МБ · unhandled ${unhandled} · ${JSON.stringify(outcomes)}`);
  }
  if (VIRTUAL) virtualNow += 100; else await sleep(100);
}

const result = {
  hours: HOURS, minutes: MINUTES, durationMs: DURATION, virtual: VIRTUAL, commands: n, queue: queue.length, changed,
  rssStartMB: Math.round(mem0 / 1048576), rssEndMB: Math.round(mem() / 1048576),
  unhandled, outcomes
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log('SOAK_RESULT ' + JSON.stringify(result));
if (unhandled > 0) process.exitCode = 1;
