// История коммитов для приёма чужих PR: трейлеры Tapyor-PR / Tapyor-Open / Co-authored-by,
// сбор соавторов и страховка команды «открой X.Y.Z».
//
// Соавторы: «открой» кладёт открытую версию ОДНИМ коммитом, поэтому вклад автора PR иначе
// теряется. Строки Co-authored-by: из коммитов с Tapyor-PR: переносятся в этот один коммит.
import { execFileSync } from 'node:child_process';

export const OPEN_TRAILER = 'Tapyor-Open:';
export const PR_TRAILER = 'Tapyor-PR:';

// Кто считается командой «открой»: имя и noreply-адрес, от которых «открой»
// делает коммит в открытом репозитории. Одна правда для open-release и страховки.
export const OPEN_AUTHOR = 'alexshikaka';
export const NOREPLY = '195445773+alexshikaka@users.noreply.github.com';

// Автор/коммиттер «свой» только при точном имени и точном адресе.
export function isOpenIdentity(name, email) {
  return String(name || '').trim().toLowerCase() === OPEN_AUTHOR
    && String(email || '').trim().toLowerCase() === NOREPLY.toLowerCase();
}

// «Свой» коммит «открой» = трейлер Tapyor-Open: И автор, И коммиттер — alexshikaka
// с noreply-адресом (ровно так «открой» и коммитит). Одного текста мало: строку
// Tapyor-Open: можно подделать в чужом PR или squash-коммите (аудит 0.34.0, A2).
// meta: { authorName, authorEmail, committerName, committerEmail }.
export function isOpenCommit(message, meta) {
  if (!/^\s*Tapyor-Open:\s*\d+\.\d+\.\d+\s*$/im.test(String(message || ''))) return false;
  if (!meta || typeof meta !== 'object') return false;
  return isOpenIdentity(meta.authorName, meta.authorEmail)
    && isOpenIdentity(meta.committerName, meta.committerEmail);
}

// Коммиты, которые уже лежали в открытом tapyor до этого порядка (создание репозитория, А10).
// Их «открой» не считает чужими. Список — только SHA: заголовки могут поменять.
// 9bf5358 — заглушка; 5b2da23 — README и документы к бете (15.11), все файлы есть и новее в снимке 0.38.1
// (разрешено владельцем 16.11: «выкладывай»)
export const ALLOWED_OPEN_SHAS = new Set(['9bf53586308689a561e05a8e0abf63f4288a1f95', '5b2da239c2edc414255705562f743d7455c73816']);

function git(repoDir, args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
}

function tryGit(repoDir, args) {
  try { return { ok: true, out: git(repoDir, args) }; } catch (e) { return { ok: false, why: String(e.stderr || e.message).trim() }; }
}

// Трейлеры из тела коммита. Возвращает { prs, coauthors, opens }.
export function parseTrailers(message) {
  const prs = [], coauthors = [], opens = [];
  for (const raw of String(message || '').split(/\r?\n/)) {
    const line = raw.trim();
    const pr = line.match(/^Tapyor-PR:\s*#?(\d+)\s*$/i);
    if (pr) { prs.push(Number(pr[1])); continue; }
    const open = line.match(/^Tapyor-Open:\s*(\d+\.\d+\.\d+)\s*$/i);
    if (open) { opens.push(open[1]); continue; }
    const co = line.match(/^Co-authored-by:\s*(.+?)\s*<([^<>]+)>\s*$/i);
    if (co) coauthors.push({ name: co[1].trim(), email: co[2].trim() });
  }
  return { prs, coauthors, opens };
}

// Без повторов: одинаковый адрес — один соавтор. Порядок первого появления сохраняется.
export function mergeCoauthors(list) {
  const seen = new Set(), out = [];
  for (const c of list || []) {
    const name = String(c && c.name || '').replace(/[<>\r\n]/g, '').trim();
    const email = String(c && c.email || '').trim();
    const key = email.toLowerCase();
    if (!name || !email || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email });
  }
  return out;
}

export const coauthorLine = (c) => 'Co-authored-by: ' + c.name + ' <' + c.email + '>';

function logRecords(repoDir, range) {
  const args = ['log', '--reverse', '--format=%H%x1f%an%x1f%s%x1f%B%x1e'];
  if (range) args.push(range);
  const res = tryGit(repoDir, args);
  if (!res.ok) return { ok: false, why: res.why, records: [] };
  const records = res.out.split('\x1e')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rec) => {
      const [sha, author, subject, body] = rec.split('\x1f');
      return { sha, author, subject, body: body || '' };
    });
  return { ok: true, records };
}

// Коммиты с Tapyor-PR: в диапазоне (fromRef..toRef) — их номера PR и Co-authored-by:.
export function collectOpenTrailers(repoDir, fromRef, toRef) {
  const range = fromRef ? fromRef + '..' + toRef : toRef;
  const res = logRecords(repoDir, range);
  if (!res.ok) return { ok: false, why: res.why, prs: [], coauthors: [], commits: [] };
  const prs = [], coauthors = [], commits = [];
  for (const rec of res.records) {
    const t = parseTrailers(rec.body);
    if (!t.prs.length) continue;
    commits.push({ sha: rec.sha, subject: rec.subject, prs: t.prs });
    for (const n of t.prs) if (!prs.includes(n)) prs.push(n);
    coauthors.push(...t.coauthors);
  }
  return { ok: true, prs, coauthors: mergeCoauthors(coauthors), commits };
}

// Страховка «открой»: в origin/<branch> не должно быть коммитов, сделанных не командой «открой»
// (нет строки Tapyor-Open ИЛИ автор/коммиттер не alexshikaka с noreply-адресом) и не из
// разрешённого списка. Локальные коммиты «открой», которых ещё нет на сервере, не страшны —
// их можно заменить; чужие локальные — тоже стоп.
const LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%s%x1f%B';

// Разбор одной записи журнала в «свой/чужой».
function readCommit(repoDir, sha) {
  const info = tryGit(repoDir, ['log', '-1', '--format=' + LOG_FORMAT, sha]);
  if (!info.ok) return { sha: sha, author: '?', subject: 'не удалось прочитать коммит', open: false };
  const [full, author, authorEmail, committer, committerEmail, subject, body] = info.out.split('\x1f');
  const open = isOpenCommit(body || '', {
    authorName: author, authorEmail: authorEmail,
    committerName: committer, committerEmail: committerEmail
  });
  return { sha: full, author: author, subject: subject, open: open };
}

export function checkOpenSafety(repoDir, branch, opts = {}) {
  const allowed = opts.allowed || ALLOWED_OPEN_SHAS;
  const remoteRef = 'origin/' + branch;
  const remote = tryGit(repoDir, ['rev-list', remoteRef]);
  if (!remote.ok) return { ok: false, why: 'не могу прочитать ' + remoteRef + ': ' + remote.why, foreign: [], localForeign: [], localOpen: [], remoteRef };
  const foreign = [];
  for (const sha of remote.out.split('\n').filter(Boolean)) {
    if (allowed.has(sha)) continue;
    const c = readCommit(repoDir, sha);
    if (c.open) continue;
    foreign.push({ sha: c.sha, author: c.author, subject: c.subject });
  }
  const local = tryGit(repoDir, ['rev-list', remoteRef + '..HEAD']);
  const localOpen = [], localForeign = [];
  if (local.ok) {
    for (const sha of local.out.split('\n').filter(Boolean)) {
      const c = readCommit(repoDir, sha);
      (c.open ? localOpen : localForeign).push({ sha: c.sha, author: c.author, subject: c.subject });
    }
  }
  return { ok: !foreign.length && !localForeign.length, foreign, localForeign, localOpen, remoteRef };
}
