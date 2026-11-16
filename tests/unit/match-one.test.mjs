// Ф1: matchOne (канал match-line) выбирает источник «по доступу».
// Яндекс — окончательный ответ, только если трек у него играет целиком (вход + Плюс);
// иначе спрашиваем YouTube и берём лучший вариант правилом умного поиска (отрывок −30).
// Запускаем настоящий setup() из src/main/yandex.js с поддельными ответами площадок.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yandexModule = require('../../src/main/yandex.js');
const match = require('../../src/match.js');

const YM = { src: 'ym', id: 'ym1', albumId: 'a1', title: 'Группа крови', author: 'Кино', duration: '5:00', seconds: 300 };
const YT = {
  videoId: 'v1',
  title: 'Кино - Группа крови',
  author: { name: 'Кино' },
  duration: { timestamp: '5:00', seconds: 300 },
  thumbnail: ''
};

function makeApp(opts) {
  const o = Object.assign({
    hasPlus: true, token: 'test-token', ymEnabled: true, ytEnabled: true,
    ymTracks: [Object.assign({}, YM)], ytVideos: [Object.assign({}, YT)], ytFail: false
  }, opts || {});
  const calls = { ym: 0, yt: 0, status: 0 };
  const handlers = {};
  const mem = {};
  const settingsStore = {
    get: (k) => mem[k],
    set: (k, v) => { mem[k] = v; }
  };
  const ym = {
    setLogger: () => {},
    setHooks: () => {},
    searchTracksPage: async () => { calls.ym++; return o.ymTracks.map((t) => Object.assign({}, t)); },
    accountStatus: async () => { calls.status++; return { hasPlus: !!o.hasPlus, name: 'Тест' }; }
  };
  const ctx = {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} },
    safeStorage: { isEncryptionAvailable: () => false },
    clipboard: { writeText: () => {} },
    shell: { openExternal: () => {} },
    openExternal: { allowed: () => false },
    cfg: (k) => {
      if (k === 'ymEnabled') return o.ymEnabled;
      if (k === 'ytEnabled') return o.ytEnabled;
      if (k === 'preferLocal') return false; // свои файлы сюда не подмешиваем
      return undefined;
    },
    settingsStore,
    log: () => {},
    logDebug: () => {},
    readSettings: () => (o.token ? { ymToken: Buffer.from(o.token, 'utf8').toString('base64') } : {}),
    writeSettings: () => {},
    yandexLogin: async () => ({}),
    autofixR: { note: () => {}, success: () => {} },
    ytsT: async () => {
      calls.yt++;
      if (o.ytFail) throw new Error('YouTube не отвечает');
      return { videos: o.ytVideos.map((v) => Object.assign({}, v)) };
    },
    library: { search: () => [] },
    match,
    ym,
    streamBusy: { begin: () => {}, end: () => {} },
    ytSuggest: async () => []
  };
  yandexModule.setup(ctx);
  return {
    calls,
    matchLine: (line, opts) => handlers['match-line'](null, line, opts)
  };
}

test('matchOne: у Яндекса полный доступ — его ответ окончательный, YouTube не спрашиваем', async () => {
  const app = makeApp({ hasPlus: true });
  const r = await app.matchLine('Кино — Группа крови', {});
  assert.equal(r.status, 'exact');
  assert.equal(r.track.src, 'ym');
  assert.ok(!r.preview, 'полный трек не должен помечаться как отрывок');
  assert.equal(app.calls.ym, 1);
  assert.equal(app.calls.yt, 0, 'при полном доступе YouTube не должен искаться');
});

test('matchOne: у Яндекса только отрывок, YouTube целиком — выбираем YouTube', async () => {
  const app = makeApp({ hasPlus: false });
  const r = await app.matchLine('Кино — Группа крови', {});
  assert.equal(r.status, 'exact');
  assert.equal(r.track.src, 'yt', 'умный поиск: отрывок Яндекса (−30) проигрывает полному YouTube');
  assert.ok(!r.preview);
  assert.equal(app.calls.ym, 1);
  assert.equal(app.calls.yt, 1);
});

test('matchOne: only=ym — ищем только Яндекс, даже если он даёт отрывок', async () => {
  const app = makeApp({ hasPlus: false });
  const r = await app.matchLine('Кино — Группа крови', { only: 'ym' });
  assert.equal(r.status, 'exact');
  assert.equal(r.track.src, 'ym');
  assert.equal(r.preview, true, 'выбранный отрывок Яндекса помечается');
  assert.equal(app.calls.yt, 0, 'при only=ym YouTube не трогаем');
});

test('matchOne: без входа в Яндекс и с YouTube — берём YouTube', async () => {
  const app = makeApp({ hasPlus: false, token: '' });
  const r = await app.matchLine('Кино — Группа крови', {});
  assert.equal(r.track.src, 'yt');
  assert.equal(app.calls.yt, 1);
});

test('matchOne: отрывок Яндекса — единственное, что нашлось, отдаём его с пометкой', async () => {
  const app = makeApp({ hasPlus: false, ytFail: true });
  const r = await app.matchLine('Кино — Группа крови', {});
  assert.equal(r.track.src, 'ym');
  assert.equal(r.preview, true);
});

test('matchOne: выключенный Яндекс не ищется, остаётся YouTube', async () => {
  const app = makeApp({ hasPlus: true, ymEnabled: false });
  const r = await app.matchLine('Кино — Группа крови', {});
  assert.equal(r.track.src, 'yt');
  assert.equal(app.calls.ym, 0);
});

test('matchOne: ничего не подтвердилось, но варианты для «Найти» остаются', async () => {
  const app = makeApp({ hasPlus: false, ymTracks: [{ src: 'ym', id: 'ym9', title: 'Совсем другая', author: 'Кто-то' }], ytVideos: [] });
  const r = await app.matchLine('Кино — Группа крови', {});
  assert.equal(r.status, 'none');
  assert.equal(r.track, null);
  assert.ok(r.alts.length > 0, 'кандидаты должны уйти в «другие варианты»');
});
