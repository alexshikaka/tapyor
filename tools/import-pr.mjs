// Перенос чужого PR из открытого `alexshikaka/tapyor` в закрытую `experiment` (часть B задания 11.11).
//
//   node tools/import-pr.mjs 12                 — скачать, перевести пути, применить, закоммитить
//   node tools/import-pr.mjs 12 --no-apply      — только скачать и перевести, ничего не менять
//   node tools/import-pr.mjs 12 --force         — переносить, даже если классификатор нашёл опасные признаки
//   node tools/import-pr.mjs 12 --test          — перед коммитом прогнать npm test и npm run test:unit
//   node tools/import-pr.mjs 12 --repo alexshikaka/tapyor-modules
//   node tools/import-pr.mjs 12 --decided-by владелец
//   node tools/import-pr.mjs 12 --diff-file <файл> --meta-file <файл>   — проверка механики без сети
//
// Почему перенос, а не «Merge»: «открой X.Y.Z» кладёт снимок одним коммитом, поэтому правка,
// влитая кнопкой в открытом репозитории, молча пропадёт при следующем «открой». Автор PR
// остаётся соавтором: его строка Co-authored-by: попадает в коммит открытой версии.
//
// На GitHub инструмент ничего не пишет: комментарий и закрытие PR делает «открой X.Y.Z» с --push.
// Требования: ветка experiment, чистое рабочее дерево. Временные файлы — TAPYOR_SANDBOX_DIR,
// по умолчанию папка `sandbox` рядом с проектом.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mapPatchPaths, readOverlayPaths } from './lib/pr-paths.mjs';
import { classifyPrChange, describeFlag, canRunPrTests, PR_TEST_MANUAL } from './lib/pr-risk.mjs';
import { coauthorLine } from './lib/pr-git.mjs';
import { addPrLogRow } from './lib/pr-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const num = Number((argv.find((a) => /^\d+$/.test(a)) || '').trim());
const repo = opt('--repo', 'alexshikaka/tapyor');
const sandbox = process.env.TAPYOR_SANDBOX_DIR || path.resolve(root, '..', 'sandbox');
const force = argv.includes('--force');
const noApply = argv.includes('--no-apply');
const withTests = argv.includes('--test');
const decidedBy = opt('--decided-by', 'модель');
const diffFile = opt('--diff-file', '');
const metaFile = opt('--meta-file', '');

const say = (s) => console.log(s);
function stop(why, code) { console.log('\n⛔ ' + why); process.exit(code || 1); }
function run(cmd, args, opts) {
  return String(execFileSync(cmd, args, Object.assign({ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}))).trim();
}
function tryRun(cmd, args, opts) {
  try { return { ok: true, out: run(cmd, args, opts) }; } catch (e) { return { ok: false, why: String((e.stderr || '') + (e.stdout || '') || e.message).trim() }; }
}
const cut = (s, n) => { const c = [...String(s || '').replace(/\s+/g, ' ').trim()]; return c.length > n ? c.slice(0, n - 1).join('') + '…' : c.join(''); };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// ── 0. Что просили и где мы ─────────────────────────────────────────────────────────────────────
if (!num) stop('Укажи номер PR: node tools/import-pr.mjs 12 [--force] [--no-apply] [--test]');
if (!fs.existsSync(path.join(root, '.git'))) stop('Это не репозиторий: нет ' + path.join(root, '.git'));
const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (!branch.ok) stop('Не могу определить ветку: ' + branch.why);
if (branch.out !== 'experiment') stop('Сейчас ветка «' + branch.out + '», а переносим только в experiment. Переключись и повтори.');
const dirty = tryRun('git', ['status', '--porcelain']);
if (!dirty.ok) stop('Не могу прочитать состояние git: ' + dirty.why);
if (dirty.out) stop('Рабочее дерево не чистое — сначала разберись с этими файлами:\n' + dirty.out);

// Уже переносили? Повторный перенос того же номера — почти всегда ошибка.
const already = tryRun('git', ['log', '--format=%h %s', '-E', '--grep=^Tapyor-PR: ' + num + '$']);
if (already.ok && already.out) stop('PR #' + num + ' уже переносился:\n' + already.out + '\nЕсли правку надо повторить — --force.', 5);

// ── 1. Метаданные PR (только чтение) ────────────────────────────────────────────────────────────
say('PR #' + num + ' из ' + repo + ': читаю сведения…');
let metaRes;
if (metaFile) {
  try { metaRes = { ok: true, out: fs.readFileSync(metaFile, 'utf8') }; } catch (e) { stop('Не могу прочитать --meta-file: ' + e.message); }
} else {
  metaRes = tryRun('gh', ['pr', 'view', String(num), '-R', repo, '--json',
    'number,title,author,state,isDraft,headRefOid,baseRefName,additions,deletions,files']);
}
if (!metaRes.ok) stop('Не могу прочитать PR #' + num + ' через gh: ' + metaRes.why);
let meta;
try { meta = JSON.parse(metaRes.out); } catch (e) { stop('gh вернул не JSON: ' + e.message); }
const title = cut(meta.title, 120);
const author = (meta.author && meta.author.login) || '';
if (!author) stop('У PR нет автора — переносить нечего.');
say('  «' + title + '», автор @' + author + ', состояние ' + meta.state + (meta.isDraft ? ', черновик' : '') + ', файлов ' + (meta.files || []).length);

// ── 2. Дифф в песочницу и перевод путей ─────────────────────────────────────────────────────────
const diffRes = diffFile
  ? (() => { try { return { ok: true, out: fs.readFileSync(diffFile, 'utf8') }; } catch (e) { return { ok: false, why: e.message }; } })()
  : tryRun('gh', ['pr', 'diff', String(num), '-R', repo]);
if (!diffRes.ok) stop('Не могу скачать дифф PR #' + num + ': ' + diffRes.why);
if (!diffRes.out.trim()) stop('Пустой дифф — переносить нечего.');
const workDir = path.join(sandbox, 'pr-import', String(num));
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
const rawPath = path.join(workDir, 'pr-open.diff');
const closedPath = path.join(workDir, 'pr-closed.diff');
fs.writeFileSync(rawPath, diffRes.out + '\n', 'utf8');
const translated = mapPatchPaths(diffRes.out, readOverlayPaths(root));
fs.writeFileSync(closedPath, translated + '\n', 'utf8');
say('  дифф: ' + rawPath);
say('  пути переведены для закрытого репозитория: ' + closedPath);

// ── 3. Опасные признаки ─────────────────────────────────────────────────────────────────────────
const risk = classifyPrChange({ files: meta.files || [], diff: diffRes.out, additions: meta.additions, deletions: meta.deletions });
say('\nИзменений: +' + (meta.additions || 0) + ' −' + (meta.deletions || 0) + ', файлов ' + (meta.files || []).length);
if (risk.flags.length) {
  say('⚠️ Опасные признаки (решение по ним принимает владелец):');
  for (const f of risk.flags) say('  ' + describeFlag(f));
  if (!force) {
    if (withTests) say('\n--test: ' + PR_TEST_MANUAL + '.');
    stop('Перенос остановлен: опасные признаки. Сначала решение владельца; если оно есть — повтори с --force.', 3);
  }
  say('  (--force: продолжаю по решению владельца)');
} else {
  say('Опасных признаков нет.');
}

if (noApply) {
  say('\n--no-apply: ничего не применено. Файлы для разбора:');
  say('  ' + rawPath + '\n  ' + closedPath);
  process.exit(0);
}

// ── 4. Применение ───────────────────────────────────────────────────────────────────────────────
say('\nПрименяю к experiment…');
const apply = tryRun('git', ['apply', '--3way', '--whitespace=nowarn', closedPath]);
if (!apply.ok) {
  const st = tryRun('git', ['status', '--porcelain']);
  if (st.ok && st.out) say('\nВ рабочем дереве остались следы попытки:\n' + st.out + '\nРазберись вручную (git checkout -- . / git reset --hard HEAD — только осознанно).');
  stop('Правку надо перенести ПО СМЫСЛУ: git apply --3way не лёг.\n' + cut(apply.why, 600), 2);
}
run('git', ['add', '-A']);
const conflicts = tryRun('git', ['diff', '--name-only', '--diff-filter=U']);
if (conflicts.ok && conflicts.out) {
  stop('После применения остались конфликты — разберись вручную, коммит не сделан:\n' + conflicts.out, 2);
}
const changed = run('git', ['status', '--porcelain']);
say('  изменено файлов: ' + changed.split('\n').filter(Boolean).length);

// ── 5. Тесты (по желанию) — до коммита, чтобы не коммитить сломанное ────────────────────────────
function npm(args) {
  // npm — это npm.cmd; на Windows его нельзя запустить без оболочки (спавн .cmd падает).
  if (process.platform === 'win32') {
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm'].concat(args), { cwd: root, stdio: 'inherit' });
  }
  return spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
}
if (withTests) {
  // A3: тесты PR исполняют его код (и тесты, и security-модули теперь под ⚠).
  // Без явного --force такие тесты не запускаем — это сказано ещё на проверке признаков выше.
  const gate = canRunPrTests(risk.flags, force);
  if (!gate.run) {
    say('\n--test: ' + gate.message + '. Пропускаю.');
  } else {
    say('\n--test: npm test…');
    const t1 = npm(['test']);
    say('npm test: код ' + t1.status);
    if (t1.status !== 0) stop('npm test не прошёл — коммит НЕ сделан, правка осталась в рабочем дереве. Почини или откатись.', 4);
    say('\nnpm run test:unit…');
    const t2 = npm(['run', 'test:unit']);
    say('npm run test:unit: код ' + t2.status);
    if (t2.status !== 0) stop('npm run test:unit не прошёл — коммит НЕ сделан, правка осталась в рабочем дереве.', 4);
  }
}

// ── 6. Соавтор и коммит ──────────────────────────────────────────────────────────────────────────
say('\nОформляю коммит…');
let person = { name: author, email: author + '@users.noreply.github.com' };
const userRes = metaFile ? { ok: false } : tryRun('gh', ['api', 'users/' + author, '--jq', '{id,login,name}']);
if (userRes.ok) {
  try {
    const u = JSON.parse(userRes.out);
    person = {
      name: String(u.name || u.login || author).replace(/[<>\r\n]/g, '').trim(),
      email: u.id + '+' + (u.login || author) + '@users.noreply.github.com',
    };
  } catch (e) { say('  (не разобрал ответ gh api users — беру адрес по логину)'); }
} else {
  say(metaFile ? '  (проверка без сети — адрес по логину)' : '  (gh api users не ответил — беру адрес по логину)');
}
const msg = 'Перенос PR #' + num + ': ' + title + '\n\nTapyor-PR: ' + num + '\n' + coauthorLine(person);
const msgFile = path.join(workDir, 'commit-message.txt');
fs.writeFileSync(msgFile, msg + '\n', 'utf8');
const commit = tryRun('git', ['commit', '-F', msgFile]);
if (!commit.ok) stop('Не удалось закоммитить: ' + cut(commit.why, 500));
const sha = run('git', ['rev-parse', '--short', 'HEAD']);
say('✓ коммит ' + sha + ' «Перенос PR #' + num + ': ' + title + '»');

// ── 7. Журнал решений ──────────────────────────────────────────────────────────────────────────
addPrLogRow(root, {
  number: num, author: '@' + author, date: today(), decision: 'перенесён',
  commit: sha, decidedBy, version: '',
});
run('git', ['add', 'docs/PR-LOG.md']);
const logCommit = tryRun('git', ['commit', '-m', 'PR-LOG: #' + num + ' перенесён (коммит ' + sha + ')']);
if (logCommit.ok) say('✓ журнал: docs/PR-LOG.md (коммит ' + run('git', ['rev-parse', '--short', 'HEAD']) + ')');
else say('  журнал не изменился — коммит не нужен');

// ── 8. Дальше ──────────────────────────────────────────────────────────────────────────────────
say('\nДальше:');
say('  1. npm test');
say('  2. npm run test:unit');
say('  3. чистая копия HEAD (AGENTS.md, п. 6): git worktree add --detach <временная папка> HEAD →');
say('     npm ci → npm test → npm run test:unit → git worktree remove --force <папка> → git worktree prune');
say('  4. на стрим в отладочном канале; после «открой X.Y.Z» в docs/PR-LOG.md появится версия,');
say('     а PR закроется с ответом «Вошло в X.Y.Z, спасибо! Ты в соавторах этой версии.»');
process.exit(0);
