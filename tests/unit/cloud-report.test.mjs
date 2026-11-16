// B10 / P5b M5, L3, L4: отчёты об ошибках.
//  M5 — у существующей задачи обновляем ТОЛЬКО свой блок статистики, а не всё описание (владелец мог
//       дописать заметки руками).
//  L3 — битый JSON в блоке статистики не роняет функцию: блок начинается заново.
//  L4 — наружу при сбое GitHub уходит короткий код, а не первые 200 символов ответа GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staged } from './helpers/cloud-stage.mjs';

process.env.SHARED_KEY = 'K';
process.env.GITHUB_TOKEN = 't';
process.env.GITHUB_REPO = 'o/r';

const rp = staged('yc-report');
const H = { 'X-Tapyor-Key': 'K' };
const ev = (iid) => ({ httpMethod: 'POST', headers: H, requestContext: { identity: { sourceIp: '5.5.5.1' } },
  body: JSON.stringify({ fp: 'abc', service: 'ym', stage: 'play', code: 'E1', msg: 'm', app: '0.32.0', iid }) });
const json = (r) => JSON.parse(r.body);
const STATS = /<!--stats (\{[\s\S]*?\}) -->/;

// Подделка GitHub: одна существующая задача.
function existingIssue(body) {
  const calls = { patched: null, searched: 0 };
  global.fetch = async (url, o) => {
    const u = String(url);
    if (u.includes('/search/issues')) {
      calls.searched++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ total_count: 0 }) };
    }
    if (u.includes('/issues?') && (!o || !o.method || o.method === 'GET')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ number: 5, state: 'open', labels: [], body }]) };
    }
    if (o && o.method === 'PATCH') {
      calls.patched = JSON.parse(o.body);
      return { ok: true, status: 200, text: async () => '{}' };
    }
    throw new Error('unexpected ' + u);
  };
  return calls;
}

test('M5: у существующей задачи переписывается только блок статистики, заметки владельца целы', async () => {
  rp._rate.reset();
  const before = 'Ручная заметка владельца. Не удалять.\n';
  const after = '\nХвост заметки тоже на месте.';
  const oldBlock = '<!--stats {"users":[],"count":0,"versions":[],"recipes":[],"first":"a","last":"a","upd":0} -->';
  const calls = existingIssue(before + oldBlock + after);
  const r = await rp.handler(ev('i-stats'));
  assert.equal(r.statusCode, 200);
  assert.equal(calls.searched, 0, 'задача уже есть — суточный счётчик не нужен');
  assert.ok(calls.patched && calls.patched.body, 'описание обновлено');
  assert.ok(calls.patched.body.startsWith(before), 'заметка до блока сохранена');
  assert.ok(calls.patched.body.endsWith(after), 'заметка после блока сохранена');
  assert.match(calls.patched.body, /"count":1/);
  assert.match(calls.patched.body, /"users":\["[0-9a-f]{12}"\]/);
  assert.match(calls.patched.body, STATS);
});

test('L3: битый JSON в блоке статистики — функция не падает, блок начинается заново', async () => {
  rp._rate.reset();
  const before = 'Заметка до. ';
  const after = ' Заметка после.';
  const calls = existingIssue(before + '<!--stats {это не json} -->' + after);
  const r = await rp.handler(ev('i-broken-stats'));
  assert.equal(r.statusCode, 200, r.body);
  assert.match(calls.patched.body, /^Заметка до\. /);
  assert.match(calls.patched.body, / Заметка после\.$/);
  const m = STATS.exec(calls.patched.body);
  assert.ok(m, 'в новом описании есть блок статистики');
  const st = JSON.parse(m[1]);
  assert.equal(st.count, 1);
  assert.equal(st.users.length, 1);
});

test('L4: сбой GitHub — наружу короткий код github, без текста ответа GitHub', async () => {
  rp._rate.reset();
  global.fetch = async () => ({ ok: false, status: 403, text: async () => 'секретные подробности репозитория и лимитов' });
  const r = await rp.handler(ev('i-gh-error'));
  assert.equal(r.statusCode, 500);
  const j = json(r);
  assert.equal(j.error, 'github');
  assert.ok(!r.body.includes('секретные подробности'), 'текст ответа GitHub наружу не уходит');
  assert.equal(j.tapyor_error, undefined, 'это ответ внешнего сервиса, а не наш сбой');
});
