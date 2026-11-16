// YR1: пока yt-dlp запущен (поиск, плейлисты, поток и прочие запуски через execTracked),
// движок не обновляем — подмена exe на лету ломает этот запуск. И наоборот: пока идёт
// обновление, новые запуски ждут его конца.
//
// Настоящих процессов и сети нет: execFile и https подменены. Файлы — во временной папке.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ytdlp = require('../../src/main/ytdlp.js');

const VERSION = '2026.01.01';
const NEW_ENGINE = Buffer.from('новый движок yt-dlp');

function tmpProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-yr1-'));
}

// Подделка https.get: SHA2-256SUMS и сам exe отдаём готовыми кусками.
function fakeHttps(parts) {
  const calls = [];
  function get(url, opts, cb) {
    calls.push(url);
    const body = /SHA2-256SUMS/.test(url) ? parts.sums : parts.exe;
    const res = Readable.from([Buffer.from(body)]);
    res.statusCode = 200;
    res.headers = {};
    process.nextTick(() => cb(res));
    const req = new EventEmitter();
    req.setTimeout = function () { return req; };
    return req;
  }
  return { get, calls };
}

// Подделка execFile: --version отвечает сразу, остальные запуски висят,
// пока тест не завершит их событием или колбэком.
function fakeExec() {
  const live = [];
  const calls = [];
  function execFile(bin, args, opts, cb) {
    calls.push({ bin, args });
    if (args[0] === '--version') {
      const child = new EventEmitter();
      process.nextTick(() => cb(null, VERSION + '\n', ''));
      return child;
    }
    if (args[0] === 'boom') throw new Error('запуск не удался');
    const child = new EventEmitter();
    child.finish = function (err) { cb(err || null, '', ''); };
    live.push(child);
    return child;
  }
  return { execFile, live, calls };
}

function makeModule(tmp, parts, httpsFake) {
  const exec = fakeExec();
  const https = httpsFake || fakeHttps(parts || { sums: '', exe: '' });
  const lines = [];
  const mod = ytdlp.setup({
    app: { isPackaged: false, getPath: () => tmp, getVersion: () => '0.36.3' },
    fs, path, crypto, https,
    execFile: exec.execFile,
    log: (m) => lines.push(m),
    cfg: () => '',
    faultSim: { applyCall: (name, fn) => fn() },
    ytCookies: () => ({ args: [], done() {} }),
    fmtDur: () => '',
    streamBusy: { isBusy: () => false },
    srcDir: path.join(tmp, 'src'),
    childRegistry: null
  });
  return { mod, exec, https, lines };
}

function prepareProfile(tmp, parts) {
  const expected = crypto.createHash('sha256').update(parts.exe).digest('hex');
  parts.sums = expected + '  yt-dlp.exe\n';
  fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'bin', 'yt-dlp.exe'), 'старый движок');
}

test('живой запуск откладывает обновление, после завершения — обновляет', async (t) => {
  const tmp = tmpProfile();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const parts = { sums: '', exe: NEW_ENGINE };
  prepareProfile(tmp, parts);
  const { mod, exec, https, lines } = makeModule(tmp, parts);

  mod.execTracked('yt-dlp.exe', ['search', 'запрос'], {}, () => {});
  assert.equal(exec.live.length, 1, 'запуск пошёл');

  const busy = await mod.ytdlpUpdate();
  assert.equal(busy.ok, false);
  assert.equal(busy.busy, true);
  assert.match(busy.text, /запущен/);
  assert.ok(lines.some((m) => /движок сейчас запущен/.test(m)), 'своя строка в журнале: ' + lines.join(' | '));
  assert.equal(https.calls.length, 0, 'пока движок живой, в сеть за обновлением не ходим');

  // Процесс завершился — обновление больше не отложено и правда обновляет.
  exec.live[0].emit('close');
  const r = await mod.ytdlpUpdate();
  assert.equal(r.ok, true);
  assert.equal(r.updated, true);
  assert.equal(r.version, VERSION);
  assert.equal(fs.readFileSync(path.join(tmp, 'bin', 'yt-dlp.exe'), 'utf8'), NEW_ENGINE.toString());
});

test('пока идёт обновление, новый запуск ждёт его конца', async (t) => {
  const tmp = tmpProfile();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const parts = { sums: '', exe: NEW_ENGINE };
  prepareProfile(tmp, parts);
  // Рабочая копия уже свежая: обновлению останется только сверить хэш и версию.
  fs.writeFileSync(path.join(tmp, 'bin', 'yt-dlp.exe'), NEW_ENGINE);

  let releaseSums;
  const gate = new Promise((resolve) => { releaseSums = resolve; });
  let getCalls = 0;
  const https = {
    calls: [],
    get(url, opts, cb) {
      this.calls.push(url);
      getCalls += 1;
      const res = Readable.from([Buffer.from(parts.sums)]);
      res.statusCode = 200;
      res.headers = {};
      gate.then(() => cb(res));
      const req = new EventEmitter();
      req.setTimeout = function () { return req; };
      return req;
    }
  };
  const { mod, exec } = makeModule(tmp, parts, https);

  const upd = mod.ytdlpUpdate();
  assert.equal(getCalls, 1, 'обновление пошло (ждёт ответа сети)');

  mod.execTracked('yt-dlp.exe', ['search', 'пока идёт обновление'], {}, () => {});
  assert.equal(exec.calls.filter((c) => c.args[0] === 'search').length, 0, 'на полузаменённом файле не стартуем');

  releaseSums();
  const r = await upd;
  assert.equal(r.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exec.calls.filter((c) => c.args[0] === 'search').length, 1, 'после обновления запуск пошёл');
});

test('ошибка запуска не «застревает» и не уводит счётчик в минус', async (t) => {
  const tmp = tmpProfile();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const parts = { sums: '', exe: NEW_ENGINE };
  prepareProfile(tmp, parts);
  const { mod, exec } = makeModule(tmp, parts);

  // Синхронная ошибка запуска: раньше она вылетала наружу, а счётчик мог остаться занятым.
  let err = null;
  assert.doesNotThrow(() => {
    mod.execTracked('yt-dlp.exe', ['boom'], {}, (e) => { err = e; });
  });
  assert.ok(err instanceof Error, 'ошибка запуска пришла в колбэк');

  // Счётчик освободился: обновление не отложено.
  const r1 = await mod.ytdlpUpdate();
  assert.equal(r1.ok, true);
  assert.notEqual(r1.busy, true);

  // Если бы счётчик ушёл в минус, новый живой запуск не считался бы живым.
  mod.execTracked('yt-dlp.exe', ['playlist', 'PL1'], {}, () => {});
  const busy = await mod.ytdlpUpdate();
  assert.equal(busy.busy, true, 'после ошибки счётчик снова считает живой запуск');

  // Завершение через колбэк тоже освобождает счётчик (и ровно один раз).
  exec.live[exec.live.length - 1].finish(null);
  const r2 = await mod.ytdlpUpdate();
  assert.notEqual(r2.busy, true);
  assert.equal(r2.ok, true);
});

test('событие и колбэк вместе уменьшают счётчик только один раз', async (t) => {
  const tmp = tmpProfile();
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const parts = { sums: '', exe: NEW_ENGINE };
  prepareProfile(tmp, parts);
  const { mod, exec } = makeModule(tmp, parts);

  mod.execTracked('yt-dlp.exe', ['url', 'https://example.test/a'], {}, () => {});
  const first = exec.live[0];
  first.emit('close');
  first.finish(null);

  // Если уменьшили дважды, счётчик станет 0-1 = -1, и этот запуск не будет виден.
  mod.execTracked('yt-dlp.exe', ['url', 'https://example.test/b'], {}, () => {});
  const busy = await mod.ytdlpUpdate();
  assert.equal(busy.busy, true, 'второй запуск снова виден счётчику');
});
