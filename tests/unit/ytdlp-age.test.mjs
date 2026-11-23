// Возрастные ролики YouTube (18+): правило заказов, вход и причины отказа.
// Подделка execFile — процесса и сети нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const ytdlp = require('../../src/main/ytdlp.js');

const AGE_ERR = 'ERROR: [youtube] X: Sign in to confirm your age. This video may be inappropriate for some users.';
const TWO = 'https://v.example/v.mp4\nhttps://v.example/a.m4a';

// hasLogin: есть ли сохранённый вход. answers(fmt, withCookies) → { ok, stdout, stderr }
function makeModule(tmp, { hasLogin, loginLater, explicitOk, rules, answers }) {
  const calls = [];
  const lines = [];
  function execFile(bin, args, opts, cb) {
    const i = args.indexOf('-f');
    const fmt = i >= 0 ? args[i + 1] : '';
    const withCookies = args.includes('--cookies');
    calls.push({ fmt, withCookies });
    const a = answers(fmt, withCookies);
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (a.ok) cb(null, a.stdout, '');
      else { const e = new Error('Command failed'); e.code = 1; cb(e, '', a.stderr); }
    });
    return child;
  }
  const cfgMap = { videoQuality: '1080', reqRules: rules !== undefined ? rules : { explicitOk } };
  const mod = ytdlp.setup({
    app: { isPackaged: false, getPath: () => tmp, getVersion: () => '0.38.1' },
    fs, path, crypto,
    https: { get: () => new EventEmitter() },
    execFile,
    log: (m) => lines.push(m),
    cfg: (k) => (k in cfgMap ? cfgMap[k] : ''),
    faultSim: { applyCall: (name, fn) => fn() },
    // вход отдаём только когда просят именно для возрастного ролика
    ytHasCookies: (() => { let n = 0; return () => (loginLater && ++n > 1) || !!hasLogin; })(),
    ytCookies: (forStream, o) => (o && o.deny ? { args: [], done() {} } : ((hasLogin || loginLater) && o && o.age ? { args: ['--cookies', 'c.txt'], done() {} } : { args: [], done() {} })),
    fmtDur: () => '',
    streamBusy: { isBusy: () => false },
    srcDir: path.join(tmp, 'src'),
    childRegistry: null
  });
  fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'bin', 'yt-dlp.exe'), 'движок');
  return { mod, calls, lines };
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-age-')); }
const URL = 'https://www.youtube.com/watch?v=6qRBGepgWb8';

test('18+ запрещены правилами — сразу отказ, вход не трогаем', async () => {
  const tmp = tmpDir();
  const { mod, calls } = makeModule(tmp, {
    hasLogin: true, explicitOk: false,
    answers: () => ({ ok: false, stderr: AGE_ERR })
  });
  const r = await mod.streamViaYtDlp(URL);
  assert.equal(r.code, 'age-rule');
  assert.match(r.error, /18\+/);
  assert.equal(calls.length, 1, 'одна попытка: правило запрещает, повтор бессмыслен');
  assert.equal(calls[0].withCookies, false, 'куки не подключались');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('18+ разрешены, входа нет — отказ с причиной «нужен вход»', async () => {
  const tmp = tmpDir();
  const { mod, calls, lines } = makeModule(tmp, {
    hasLogin: false, explicitOk: true,
    answers: () => ({ ok: false, stderr: AGE_ERR })
  });
  const r = await mod.streamViaYtDlp(URL);
  assert.equal(r.code, 'age-no-login');
  assert.match(r.error, /нужен вход в YouTube/);
  assert.equal(calls.length, 1, 'входа нет — повторять не с чем');
  assert.ok(lines.some((l) => /18\+/.test(l) || /возраст/.test(l)), 'в журнале видно, что это возраст');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('18+ разрешены, вход есть — второй заход с куки играет', async () => {
  const tmp = tmpDir();
  const { mod, calls } = makeModule(tmp, {
    hasLogin: true, explicitOk: true,
    answers: (fmt, withCookies) => (withCookies ? { ok: true, stdout: TWO } : { ok: false, stderr: AGE_ERR })
  });
  const r = await mod.streamViaYtDlp(URL);
  assert.equal(calls.length, 2, 'первый без куки, второй с куки');
  assert.equal(calls[1].withCookies, true);
  assert.equal(r.videoUrl, 'https://v.example/v.mp4');
  assert.equal(r.audioUrl, 'https://v.example/a.m4a');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('18+ разрешены, вход есть, но не помог — честная причина', async () => {
  const tmp = tmpDir();
  const { mod, calls } = makeModule(tmp, {
    hasLogin: true, explicitOk: true,
    answers: () => ({ ok: false, stderr: AGE_ERR })
  });
  const r = await mod.streamViaYtDlp(URL);
  assert.equal(r.code, 'age-cookie-fail');
  assert.match(r.error, /вход есть/);
  assert.equal(calls.length, 2, 'без куки, потом с куки');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('не возрастная ошибка — куки для 18+ не подключаются', async () => {
  const tmp = tmpDir();
  const { mod, calls } = makeModule(tmp, {
    hasLogin: true, explicitOk: true,
    answers: () => ({ ok: false, stderr: 'ERROR: [youtube] X: Video unavailable. It was blocked due to the claimed content by SME.' })
  });
  const r = await mod.streamViaYtDlp(URL);
  assert.equal(calls.length, 1, 'чужая причина — второй заход не нужен');
  assert.match(r.error, /заблокирован по жалобе/, 'причина человеческим языком, а не stderr');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('обычное видео с куки по тумблеру не меняется: без входа — без куки', async () => {
  const tmp = tmpDir();
  const { mod, calls } = makeModule(tmp, {
    hasLogin: true, explicitOk: true,
    answers: () => ({ ok: true, stdout: TWO })
  });
  const r = await mod.streamViaYtDlp(URL);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].withCookies, false, 'обычный ролик — без куки');
  assert.equal(r.videoUrl, 'https://v.example/v.mp4');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('вход появился между заказами — второй заказ уже пробует с куки', async () => {
  const tmp = tmpDir();
  // До входа — отказ «нужен вход». После входа тот же заказ играет.
  const { mod, calls } = makeModule(tmp, {
    hasLogin: false, loginLater: true, explicitOk: true,
    answers: (fmt, withCookies) => (withCookies ? { ok: true, stdout: TWO } : { ok: false, stderr: AGE_ERR })
  });
  const first = await mod.streamViaYtDlp(URL);
  assert.equal(first.code, 'age-no-login', 'без входа честный отказ');
  assert.equal(calls.filter((c) => c.withCookies).length, 0, 'до входа куки не трогали');

  const second = await mod.streamViaYtDlp(URL);
  assert.equal(second.videoUrl, 'https://v.example/v.mp4', 'после входа возрастной ролик сыграл');
  assert.equal(calls.filter((c) => c.withCookies).length, 1, 'ровно один заход с куки');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('18+ запрещены — даже с включённым входом куки не подключаются и ролик не играет', async () => {
  const tmp = tmpDir();
  // Вход есть, и «использовать вход для воспроизведения» включён: без запрета ролик заиграл бы.
  const { mod, calls } = makeModule(tmp, {
    hasLogin: true, explicitOk: false,
    answers: (fmt, withCookies) => (withCookies ? { ok: true, stdout: TWO } : { ok: false, stderr: AGE_ERR })
  });
  const r = await mod.streamViaYtDlp(URL);
  assert.equal(r.code, 'age-rule', 'правило 18+ решает, а не наличие входа');
  assert.equal(calls.filter((c) => c.withCookies).length, 0, 'ни одна попытка не пошла с куки');
  assert.equal(r.videoUrl, undefined, 'потока нет');
  fs.rmSync(tmp, { recursive: true, force: true });
});
