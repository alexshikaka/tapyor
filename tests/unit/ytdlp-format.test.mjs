// Формат YouTube: если строгий набор не подходит («Requested format is not available»),
// пробуем проще; возраст/блокировку не повторяем. Подделка execFile — процесса и сети нет.
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

// answers: (fmt) => { ok, stdout, stderr } — что отвечает движок на конкретный -f
function makeModule(tmp, answers) {
  const calls = [];
  const lines = [];
  function execFile(bin, args, opts, cb) {
    const i = args.indexOf('-f');
    const fmt = i >= 0 ? args[i + 1] : '';
    calls.push(fmt);
    const a = answers(fmt);
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (a.ok) cb(null, a.stdout, '');
      else { const e = new Error('Command failed'); e.code = 1; cb(e, '', a.stderr); }
    });
    return child;
  }
  const mod = ytdlp.setup({
    app: { isPackaged: false, getPath: () => tmp, getVersion: () => '0.38.1' },
    fs, path, crypto,
    https: { get: () => new EventEmitter() },
    execFile,
    log: (m) => lines.push(m),
    cfg: (k) => (k === 'videoQuality' ? '1080' : ''),
    faultSim: { applyCall: (name, fn) => fn() },
    ytHasCookies: () => false,
    ytCookies: () => ({ args: [], done() {} }),
    fmtDur: () => '',
    streamBusy: { isBusy: () => false },
    srcDir: path.join(tmp, 'src'),
    childRegistry: null
  });
  // движок должен «существовать»: путь берётся из профиля
  fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'bin', 'yt-dlp.exe'), 'движок');
  return { mod, calls, lines };
}

const VIDEO = 'https://www.youtube.com/watch?v=tRsQsTMvPNg';
const TWO = 'https://v.example/v.mp4\nhttps://v.example/a.m4a';

test('формат не подошёл — пробуем проще и получаем поток', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-fmt-'));
  const { mod, calls, lines } = makeModule(tmp, (fmt) =>
    fmt.includes('[ext=mp4]')
      ? { ok: false, stderr: 'ERROR: [youtube] X: Requested format is not available. Use --list-formats for a list of available formats' }
      : { ok: true, stdout: TWO });

  const r = await mod.streamViaYtDlp(VIDEO);
  assert.equal(calls.length, 2, 'две попытки: строгий, потом мягкий');
  assert.equal(r.videoUrl, 'https://v.example/v.mp4');
  assert.equal(r.audioUrl, 'https://v.example/a.m4a');
  assert.ok(lines.some((l) => /пробую проще/.test(l)), 'в журнале видно попытку проще');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('возрастное видео — второй заход не делаем (дело не в формате)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-fmt-'));
  const { mod, calls } = makeModule(tmp, () => ({ ok: false, stderr: 'ERROR: [youtube] X: Sign in to confirm your age. This video may be inappropriate for some users.' }));

  const r = await mod.streamViaYtDlp(VIDEO);
  assert.equal(calls.length, 1, 'одна попытка: возраст куки требует, а не другой формат');
  assert.match(r.error, /нужен вход в YouTube/, 'возраст объясняется человеку, а не сырым stderr');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('строгий сработал с первого раза — одной попытки достаточно', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-fmt-'));
  const { mod, calls } = makeModule(tmp, () => ({ ok: true, stdout: TWO }));

  const r = await mod.streamViaYtDlp(VIDEO);
  assert.equal(calls.length, 1);
  assert.equal(r.videoUrl, 'https://v.example/v.mp4');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('запасные варианты идут от строгого к простому', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-fmt-'));
  const { mod, calls } = makeModule(tmp, (fmt) =>
    fmt === 'b[protocol^=http]'
      ? { ok: true, stdout: 'https://v.example/one.mp4' }
      : { ok: false, stderr: 'ERROR: [youtube] X: Requested format is not available.' });

  const r = await mod.streamViaYtDlp(VIDEO);
  assert.equal(calls.length, 3, 'три попытки до простого «b»');
  assert.ok(calls[0].includes('protocol^=http'), 'первым идёт строгий');
  assert.equal(calls[2], 'b[protocol^=http]', 'последним — самый простой, но без HLS');
  assert.equal(r.url, 'https://v.example/one.mp4');
  fs.rmSync(tmp, { recursive: true, force: true });
});
