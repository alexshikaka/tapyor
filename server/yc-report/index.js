// Посредник для отчётов об ошибках Тапёра: Yandex Cloud Functions → GitHub Issues.
// Тапёр шлёт сюда короткий анонимный отчёт; функция находит задачу с тем же «отпечатком»
// и обновляет в ней счётчик, а новую создаёт, только если такой ещё нет.
// Переменные окружения: GITHUB_TOKEN (fine-grained, только Issues: Read & write), GITHUB_REPO (alexshikaka/tapyor-player).
// Среда выполнения: Node.js 18+ (есть fetch). Точка входа: index.handler
//
// G-06: свои ошибки несут tapyor_error; поле error не менялось (Тапёр 0.32 и старше работают как раньше).
// Ответ GitHub уходит БЕЗ tapyor_error — это ответ внешнего сервиса, а не сбой нашего облака.
// G-07: лимит частоты, общий ключ, адрес клиента и ответ — в server/common/*.js.
'use strict';

const { reply, errReply, slowDown } = require('./common/reply');
const { keyOk } = require('./common/key');
const { createRate } = require('./common/rate');
const { readBody } = require('./common/body');

const GH = 'https://api.github.com';
const MAX_NEW_PER_DAY = 30;      // не больше 30 новых задач в сутки
const UPDATE_EVERY_MS = 10 * 60 * 1000; // счётчик в задаче обновляем не чаще раза в 10 минут (кроме новых пользователей)
const MAX_BODY = 8000;
const seen = new Map();          // память «экземпляра» функции: лимит 1 отчёт в минуту с одной установки
let day = '', newToday = 0;     // быстрый счётчик экземпляра; общий суточный лимит считает GitHub (createdToday)

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
// Убираем всё личное, даже если оно случайно попало в текст
function scrub(s) {
  return String(s || '')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\…')
    .replace(/\/(home|Users)\/[^/\s]+/g, '/$1/…')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '…@…')
    .replace(/(token|cookie|sapisid|sid|auth|key|secret|password)[=:]\s*\S+/gi, '$1=…')
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '…');
}
function verCmp(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }
const STATS_RE = /<!--stats (\{[\s\S]*?\}) -->/;
// M5: свой блок статистики — единственное, что функция переписывает в существующей задаче.
const statsBlock = (st) => '<!--stats ' + JSON.stringify(st) + ' -->';
// Свежая статистика: новая задача или битый/пропавший блок у существующей (L3).
const freshStats = (stamp) => ({ users: [], count: 0, versions: [], recipes: [], first: stamp, last: stamp, upd: 0 });

async function gh(path, opts) {
  const r = await fetch(GH + path, Object.assign({ signal: AbortSignal.timeout(8000) }, opts, { headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'tapyor-report', 'Content-Type': 'application/json' } }));
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok && r.status !== 422) throw new Error('GitHub ' + r.status + ': ' + t.slice(0, 200));
  return j;
}
// Сколько автозадач уже создано сегодня (UTC) — по данным GitHub, общий для всех экземпляров. null — не узнали.
async function createdToday(repo, today) {
  try {
    const j = await gh('/search/issues?per_page=1&q=' + encodeURIComponent('repo:' + repo + ' is:issue label:auto-report created:>=' + today));
    return j && typeof j.total_count === 'number' ? j.total_count : null;
  } catch (e) { console.log('report: не узнал счётчик за сутки — ' + String(e.message || e).slice(0, 80)); return null; }
}
function body(rep, st) {
  return [
    '**Автоотчёт Тапёра.** Задача создана автоматически; одинаковые ошибки разных пользователей собираются сюда.',
    '',
    '| | |', '|---|---|',
    '| Площадка | ' + rep.service + ' |', '| Этап | ' + rep.stage + ' |', '| Код | `' + rep.code + '` |',
    '| Пользователей | ' + st.users.length + ' |', '| Всего отчётов | ' + st.count + ' |',
    '| Версии Тапёра | ' + st.versions.join(', ') + ' |', '| Рецепты | ' + st.recipes.join(', ') + ' |',
    '| Первый раз | ' + st.first + ' |', '| Последний раз | ' + st.last + ' |',
    '', '**Сообщение (последнее):**', '```', rep.msg, '```',
    rep.details ? '**Подробности:**\n```\n' + rep.details + '\n```' : '',
    '', 'Чтобы отчёты со старых версий не открывали задачу снова, при закрытии добавь метку `fixed-in-X.Y.Z`.',
    statsBlock(st)
  ].join('\n');
}

const rate = createRate();

// Ответ как раньше, но со своим Content-Type: у этой функции исторически 'application/json' без charset.
// Менять заголовок не будем — поведение функций не должно меняться (G-07).
const res = (code, obj) => reply(code, obj, { 'Content-Type': 'application/json' });

exports.handler = async function (event) {
  if (!keyOk(event)) { console.log('отклонён запрос без общего ключа'); return errReply(403, 'forbidden', 'forbidden'); }

  try {
    if ((event.httpMethod || 'POST') !== 'POST') return errReply(405, 'POST only', 'method');
    const wait = rate.wait(event);
    if (wait) return slowDown(wait);
    const parsed = readBody(event, MAX_BODY);
    if (parsed.code === 'too_big') return errReply(413, 'too big', 'too_big');
    if (parsed.code) return errReply(400, 'bad report', 'bad_request');
    const q = parsed.value;
    const rep = {
      fp: clip(q.fp, 16).replace(/[^a-z0-9]/gi, ''), service: clip(q.service, 20).replace(/[^\w.-]/g, ''), stage: clip(q.stage, 30).replace(/[^\w.-]/g, ''),
      code: scrub(clip(q.code, 40)), msg: scrub(clip(q.msg, 600)), details: scrub(clip(q.details, 1500)),
      app: clip(q.app, 12).replace(/[^\d.]/g, ''), recipes: clip(q.recipes, 8).replace(/[^\d]/g, ''), os: clip(q.os, 30).replace(/[^\w .-]/g, ''),
      iid: clip(q.iid, 40).replace(/[^\w-]/g, '')
    };
    if (!rep.fp || !rep.service || !rep.iid || !rep.app) return errReply(400, 'bad report', 'bad_request');
    const now = Date.now();
    if (seen.get(rep.iid) > now - 60000) return errReply(429, 'slow down', 'rate_limited');
    seen.set(rep.iid, now);
    // TAP-05: раньше при 5000 записях память сбрасывалась целиком (и лимит вместе с ней) — теперь убираем только устаревшие
    if (seen.size > 5000) for (const [k, t] of seen) if (t <= now - 60000) seen.delete(k);
    const repo = process.env.GITHUB_REPO;
    const fpLabel = 'fp-' + rep.fp;
    const list = await gh('/repos/' + repo + '/issues?state=all&per_page=5&labels=' + encodeURIComponent(fpLabel));
    const issue = (list || []).find((i) => !i.pull_request);
    const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
    const userHash = require('crypto').createHash('sha256').update(rep.iid).digest('hex').slice(0, 12);
    if (issue) {
      const fixed = (issue.labels || []).map((l) => l.name).find((n) => /^fixed-in-/.test(n));
      if (issue.state === 'closed' && fixed && verCmp(rep.app, fixed.slice(9)) < 0) {
        return res(200, { ok: true, known: true, fixed: fixed.slice(9), issue: issue.number }); // старая версия — уже исправлено
      }
      const m = STATS_RE.exec(issue.body || '');
      // L3: JSON в блоке мог сломать сам владелец, поправив описание руками. Тогда статистику
      // начинаем заново, а не отвечаем 500 и не теряем отчёт.
      let st = null;
      if (m) { try { st = JSON.parse(m[1]); } catch (e) { console.log('report: блок статистики в задаче #' + issue.number + ' битый — начинаю заново'); } }
      if (!st || typeof st !== 'object' || !Array.isArray(st.users)) st = freshStats(stamp);
      const newUser = !st.users.includes(userHash);
      if (newUser && st.users.length < 1000) st.users.push(userHash);
      st.count++; st.last = stamp;
      if (rep.app && !st.versions.includes(rep.app)) st.versions = st.versions.concat(rep.app).slice(-12);
      if (rep.recipes && !st.recipes.includes(rep.recipes)) st.recipes = st.recipes.concat(rep.recipes).slice(-12);
      const reopen = issue.state === 'closed';
      if (newUser || reopen || now - (st.upd || 0) > UPDATE_EVERY_MS) {
        st.upd = now;
        // M5: меняем только свой блок статистики. Всё остальное описание (заметки владельца,
        // ручные правки) остаётся как есть — раньше тело собиралось заново и затирало его.
        const oldBody = String(issue.body || '');
        const newBody = m
          ? oldBody.slice(0, m.index) + statsBlock(st) + oldBody.slice(m.index + m[0].length)
          : oldBody + (oldBody ? '\n\n' : '') + statsBlock(st);
        await gh('/repos/' + repo + '/issues/' + issue.number, { method: 'PATCH', body: JSON.stringify(Object.assign({ body: newBody }, reopen ? { state: 'open' } : {})) });
      }
      return res(200, { ok: true, issue: issue.number, users: st.users.length });
    }
    const today = new Date(now).toISOString().slice(0, 10);
    if (day !== today) { day = today; newToday = 0; }
    if (newToday >= MAX_NEW_PER_DAY) return errReply(429, 'daily limit', 'daily_limit');
    // TAP-05: экземпляров функции может быть несколько — общий счётчик за сутки берём у самого GitHub
    const n = await createdToday(repo, today);
    if (n != null && n >= MAX_NEW_PER_DAY) { newToday = MAX_NEW_PER_DAY; return errReply(429, 'daily limit', 'daily_limit'); }
    newToday++;
    const st = { users: [userHash], count: 1, versions: [rep.app], recipes: rep.recipes ? [rep.recipes] : [], first: stamp, last: stamp, upd: now };
    const created = await gh('/repos/' + repo + '/issues', { method: 'POST', body: JSON.stringify({
      title: '[авто] ' + rep.service + ' / ' + rep.stage + ' / ' + rep.code,
      body: body(rep, st),
      labels: ['auto-report', fpLabel, 'svc-' + rep.service]
    }) });
    return res(200, { ok: true, issue: created && created.number, users: 1, created: true });
  } catch (e) {
    // Ответ самого GitHub (или сети) — без tapyor_error: это не наш сбой, а ответ внешнего сервиса.
    // L4: наружу — короткий код. Подробности (код и первые символы ответа GitHub) остаются только
    // в логе функции: иначе любой с ключом из установщика увидел бы внутренности репозитория и лимитов.
    console.log('report: ошибка — ' + String(e && e.message || e).slice(0, 300));
    return res(500, { error: 'github' });
  }
};
exports._rate = { wait: rate.wait, reset: () => { rate.reset(); seen.clear(); day = ''; newToday = 0; } };
