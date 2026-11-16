// Соавторы перенесённых PR и страховка «чужой коммит в main» (части B и C задания 11.11).
// Обе вещи ломаются молча: без соавторов вклад человека теряется, а без страховки «открой»
// затрёт чужую правку в открытом репозитории. Поэтому — отдельные проверки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTrailers, mergeCoauthors, coauthorLine, collectOpenTrailers, checkOpenSafety, isOpenCommit, isOpenIdentity, OPEN_AUTHOR, NOREPLY } from '../../tools/lib/pr-git.mjs';

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-prgit-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Тест']);
  return dir;
}
let n = 0;
function commitAs(dir, message, name, email) {
  fs.writeFileSync(path.join(dir, 'f' + (++n) + '.txt'), 'x' + n);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=' + name, '-c', 'user.email=' + email,
    'commit', '-q', '-m', message, '--author=' + name + ' <' + email + '>']);
  return git(dir, ['rev-parse', 'HEAD']);
}
function commit(dir, message) { return commitAs(dir, message, 'Тест', 'test@example.com'); }
// Так «открой» и делает коммит в открытом репозитории: автор и коммиттер — alexshikaka с noreply.
function commitOpen(dir, message) { return commitAs(dir, message, OPEN_AUTHOR, NOREPLY); }
const setRemote = (dir, branch, sha) => git(dir, ['update-ref', 'refs/remotes/origin/' + branch, sha]);

test('трейлеры: номер PR, соавторы, метка «открой»', () => {
  const body = 'Перенос PR #12: кнопка\n\nTapyor-PR: 12\nCo-authored-by: Иван Петров <1+ivan@users.noreply.github.com>';
  const t = parseTrailers(body);
  assert.deepEqual(t.prs, [12]);
  assert.deepEqual(t.coauthors, [{ name: 'Иван Петров', email: '1+ivan@users.noreply.github.com' }]);
  assert.deepEqual(t.opens, []);
  const own = { authorName: OPEN_AUTHOR, authorEmail: NOREPLY, committerName: OPEN_AUTHOR, committerEmail: NOREPLY };
  assert.equal(isOpenCommit('0.34.0\n\nTapyor-Open: 0.34.0', own), true);
  assert.equal(isOpenCommit('0.34.0', own), false);
  // A2: одного текста коммита мало — подпись «открой» подделывается чужим автором.
  assert.equal(isOpenCommit('0.34.0\n\nTapyor-Open: 0.34.0'), false, 'без автора/коммиттера не доверяем');
  assert.equal(isOpenCommit('0.34.0\n\nTapyor-Open: 0.34.0', { authorName: 'evil', authorEmail: 'evil@example.com' }), false);
  assert.equal(isOpenCommit('0.34.0\n\nTapyor-Open: 0.34.0', {
    authorName: 'evil', authorEmail: 'evil@example.com', committerName: OPEN_AUTHOR, committerEmail: NOREPLY,
  }), false, 'чужой автор не становится своим от одного коммиттера');
  assert.equal(isOpenCommit('0.34.0\n\nTapyor-Open: 0.34.0', { authorName: OPEN_AUTHOR, authorEmail: 'alexshikaka@users.noreply.github.com' }), false, 'адрес не тот');
  assert.equal(isOpenIdentity(OPEN_AUTHOR, NOREPLY), true);
  assert.equal(isOpenIdentity('AlexShikaka', NOREPLY.toUpperCase()), true, 'регистр не важен');
  assert.equal(isOpenIdentity(OPEN_AUTHOR, 'other@users.noreply.github.com'), false);
});

test('трейлеры: без строк — пусто, мусор не считается', () => {
  assert.deepEqual(parseTrailers('просто коммит\n\nCo-authored-by: без почты'), { prs: [], coauthors: [], opens: [] });
  assert.deepEqual(parseTrailers(undefined), { prs: [], coauthors: [], opens: [] });
});

test('соавторы: без повторов, порядок первого появления', () => {
  const out = mergeCoauthors([
    { name: 'Аня', email: 'a@example.com' },
    { name: 'Боря', email: 'b@example.com' },
    { name: 'Аня (другой регистр)', email: 'A@Example.com' },
    { name: 'Пустое имя', email: '' },
    { name: '', email: 'x@example.com' },
    { name: 'Боря', email: 'b@example.com' },
  ]);
  assert.deepEqual(out, [{ name: 'Аня', email: 'a@example.com' }, { name: 'Боря', email: 'b@example.com' }]);
  assert.equal(coauthorLine(out[0]), 'Co-authored-by: Аня <a@example.com>');
});

test('соавторы из истории: только коммиты с Tapyor-PR, между прошлой и новой версией', () => {
  const dir = tempRepo();
  const first = commit(dir, 'Перенос PR #12: раз\n\nTapyor-PR: 12\nCo-authored-by: Аня <a@example.com>\nCo-authored-by: Боря <b@example.com>');
  const second = commit(dir, 'Перенос PR #13: два\n\nTapyor-PR: 13\nCo-authored-by: Аня <A@example.com>');
  commit(dir, 'Обычный коммит\n\nCo-authored-by: Чужой <c@example.com>');
  const all = collectOpenTrailers(dir, first, 'HEAD');
  assert.equal(all.ok, true);
  assert.deepEqual(all.prs, [13], 'первый коммит — уже в прошлой открытой версии');
  assert.deepEqual(all.coauthors, [{ name: 'Аня', email: 'A@example.com' }], 'Боря и чужой остались позади');
  assert.deepEqual(all.commits.map((c) => c.prs), [[13]]);

  const fromStart = collectOpenTrailers(dir, '', 'HEAD');
  assert.deepEqual(fromStart.prs, [12, 13]);
  assert.deepEqual(fromStart.coauthors.map((c) => c.email), ['a@example.com', 'b@example.com']);
  assert.equal(second.length, 40);
});

test('страховка: чистый origin/main и локальный коммит «открой» — можно', () => {
  const dir = tempRepo();
  const base = commit(dir, 'Заглушка открытой беты: README и лицензия MIT');
  setRemote(dir, 'main', base);
  let r = checkOpenSafety(dir, 'main', { allowed: new Set([base]) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.foreign, []);

  commitOpen(dir, '0.34.0\n\nTapyor-Open: 0.34.0');
  r = checkOpenSafety(dir, 'main', { allowed: new Set([base]) });
  assert.equal(r.ok, true, 'непушенный коммит «открой» не чужой');
  assert.equal(r.localOpen.length, 1);
  assert.deepEqual(r.localForeign, []);
});

test('страховка: чужой коммит в origin/main — стоп со списком', () => {
  const dir = tempRepo();
  const foreign = commit(dir, 'Правка мимо «открой»');
  setRemote(dir, 'main', foreign);
  const r = checkOpenSafety(dir, 'main', { allowed: new Set() });
  assert.equal(r.ok, false);
  assert.equal(r.foreign.length, 1);
  assert.equal(r.foreign[0].sha, foreign);
  assert.equal(r.foreign[0].subject, 'Правка мимо «открой»');
});

test('страховка: коммит с Tapyor-Open от «открой» в origin/main — не чужой; разрешённый SHA — тоже', () => {
  const dir = tempRepo();
  const open = commitOpen(dir, '0.33.0\n\nTapyor-Open: 0.33.0');
  setRemote(dir, 'main', open);
  assert.equal(checkOpenSafety(dir, 'main', { allowed: new Set() }).ok, true);

  const allowed = commit(dir, 'Создание репозитория');
  setRemote(dir, 'main', allowed);
  assert.equal(checkOpenSafety(dir, 'main', { allowed: new Set([allowed]) }).ok, true);
  assert.equal(checkOpenSafety(dir, 'main', { allowed: new Set() }).ok, false);
});

test('страховка A2: строка Tapyor-Open от чужого автора — чужой коммит', () => {
  const dir = tempRepo();
  const forged = commit(dir, '0.34.0\n\nTapyor-Open: 0.34.0');   // «Тест <test@example.com>»
  setRemote(dir, 'main', forged);
  const r = checkOpenSafety(dir, 'main', { allowed: new Set() });
  assert.equal(r.ok, false, 'текст коммита подделан — не свой');
  assert.equal(r.foreign.length, 1);
  assert.equal(r.foreign[0].sha, forged);
  assert.equal(r.foreign[0].author, 'Тест');
});

test('страховка A2: подделана только подпись коммиттера — тоже чужой', () => {
  const dir = tempRepo();
  // Автор «открой», коммиттер чужой: open-release ставит обоих, значит это не наш коммит.
  fs.writeFileSync(path.join(dir, 'fake.txt'), 'x');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=Чужой', '-c', 'user.email=evil@example.com',
    'commit', '-q', '-m', '0.34.0\n\nTapyor-Open: 0.34.0', '--author=' + OPEN_AUTHOR + ' <' + NOREPLY + '>']);
  const sha = git(dir, ['rev-parse', 'HEAD']);
  setRemote(dir, 'main', sha);
  assert.equal(checkOpenSafety(dir, 'main', { allowed: new Set() }).ok, false);
});

test('страховка: чужой локальный коммит (не «открой») — тоже стоп', () => {
  const dir = tempRepo();
  const base = commit(dir, 'основа');
  setRemote(dir, 'main', base);
  commit(dir, 'моя правка без метки');
  const r = checkOpenSafety(dir, 'main', { allowed: new Set([base]) });
  assert.equal(r.ok, false);
  assert.equal(r.localForeign.length, 1);
  assert.equal(r.localForeign[0].subject, 'моя правка без метки');
});

test('страховка: нет origin/main — честный отказ, а не «всё хорошо»', () => {
  const dir = tempRepo();
  commit(dir, 'основа');
  const r = checkOpenSafety(dir, 'main', { allowed: new Set() });
  assert.equal(r.ok, false);
  assert.match(r.why, /origin\/main/);
});
