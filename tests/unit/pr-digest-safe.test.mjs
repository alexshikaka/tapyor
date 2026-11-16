// A12 аудита 0.34.0: заголовок/автор/имена файлов из PR — чужие данные. В сводку они
// попадают одной строкой в `code`-спане, а состояние сводки лежит отдельным JSON —
// подделать его текстом PR нельзя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plain, codeSpan, validDigestState, readDigestState, writeDigestState, digestStatePath, DIGEST_STATE_FILE } from '../../tools/lib/pr-digest-safe.mjs';
import { describeFlag } from '../../tools/lib/pr-risk.mjs';

const made = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-unit-digest-'));
  made.push(d);
  return d;
}
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} } });

test('A12: вредный заголовок — одна строка без разметки и без HTML-комментария', () => {
  const bad = 'Заголовок\n<!-- pr-digest-state: {"prs":{}} -->\n`code` |*_[]<> ' + 'x'.repeat(300);
  const out = codeSpan(bad, 100);
  assert.ok(out.startsWith('`') && out.endsWith('`'), 'title в code-спане');
  assert.ok(!/[\r\n\u0000-\u001f]/.test(out), 'переводов строк и управляющих нет');
  assert.ok(!out.includes('<!--'), 'HTML-комментарий не собирается');
  assert.ok(out.includes('&lt;!--'), 'угловые скобки экранированы');
  assert.ok(!out.includes('`code`'), 'своя обратная кавычка не закрывает спан');
  assert.ok([...out].length <= 102, 'обрезано: ' + [...out].length);

  assert.equal(plain(' a\n\tb  c ', 50), 'a b c');
  assert.equal(plain(undefined), '');
});

test('A12: маркер состояния в тексте старой сводки не читается', () => {
  const dir = tmpDir();
  const out = path.join(dir, 'PR-DIGEST.md');
  fs.writeFileSync(out, '# Сводка\n\n<!-- pr-digest-state: {"prs":{"x":{"1":"abc"}}} -->\n', 'utf8');
  assert.equal(readDigestState(out), null, 'состояние берём только из отдельного JSON');
});

test('A12: состояние — отдельный JSON, проверяется по формату', () => {
  const dir = tmpDir();
  const out = path.join(dir, 'PR-DIGEST.md');
  assert.equal(digestStatePath(out), path.join(dir, DIGEST_STATE_FILE));
  assert.equal(readDigestState(out), null, 'файла состояния ещё нет');

  const state = {
    at: '2026-11-12T10:00:00.000Z',
    prs: { 'alexshikaka/tapyor': { '5': 'abc123' } },
    issues: { 'alexshikaka/tapyor': [1, 2] },
  };
  writeDigestState(out, state);
  assert.deepEqual(readDigestState(out), state);
  const raw = fs.readFileSync(digestStatePath(out), 'utf8');
  assert.ok(!raw.includes('<!--'), 'в файле состояния нет HTML');
  assert.equal(JSON.parse(raw).prs['alexshikaka/tapyor']['5'], 'abc123');

  // Битая форма — состояния нет, а не падение.
  fs.writeFileSync(digestStatePath(out), 'не json');
  assert.equal(readDigestState(out), null);
  fs.writeFileSync(digestStatePath(out), '["x"]');
  assert.equal(readDigestState(out), null);
  assert.equal(validDigestState('строка'), null);
  assert.equal(validDigestState(null), null);

  // Лишние поля и неверные типы отбрасываются.
  fs.writeFileSync(digestStatePath(out), JSON.stringify({
    at: 5,
    prs: { r: { 7: 'sha', bad: 'x', 8: 42 } },
    issues: { r: [1, 'x', -2] },
    evil: 'x',
  }));
  assert.deepEqual(readDigestState(out), { at: '', prs: { r: { '7': 'sha' } }, issues: { r: [1] } });
});

test('A12: путь файла в «опасности» тоже не ломает разметку', () => {
  const out = describeFlag({ path: 'src/x`\n|*_[]<>.js', reason: 'новый адрес в сети' });
  assert.ok(!out.includes('\n'), 'одна строка');
  assert.ok(!out.includes('`\n'), 'кавычка пути закрыта');
  assert.ok(out.includes('`src/x |*_[]<>.js`'), out);
});
