// Проверка адреса origin для команды «открой X.Y.Z» (аудит 0.34.0, A1).
//
// Раньше хватало вхождения подстроки «tapyor» в адрес: под неё подходили и
// alexshikaka/tapyor-player, и alexshikaka/tapyor-releases, и чужой форк evil/tapyor.
// Теперь сравниваем ТОЧНО владельца и имя репозитория (регистр не важен), разбирая
// https-, ssh- и scp-вид адреса, с «.git» или без. Ветка — только main.
//
// Модуль чистый: ни git, ни файлов. Его зовут дважды за прогон open-release —
// в начале и ещё раз прямо перед удалением файлов в клоне.

export const OPEN_OWNER = 'alexshikaka';
export const OPEN_REPO = 'tapyor';
export const OPEN_BRANCH = 'main';

// Разобрать адрес remote в { host, owner, repo } или null, если это не похоже на адрес.
export function parseOrigin(url) {
  let s = String(url == null ? '' : url).trim();
  if (!s) return null;
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (/^[A-Za-z]:[\\/]/.test(s)) return null;            // локальный путь Windows, а не адрес
  if (/^file:\/\//i.test(s)) return null;

  let host = '';
  let rest = '';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(s);
  if (scheme) {
    let after = scheme[2];
    // отбросить учётные данные: git@github.com/… → github.com/…
    const slash = after.indexOf('/');
    const authority = slash >= 0 ? after.slice(0, slash) : after;
    rest = slash >= 0 ? after.slice(slash + 1) : '';
    const at = authority.lastIndexOf('@');
    host = at >= 0 ? authority.slice(at + 1) : authority;
  } else {
    // scp-вид: git@github.com:owner/repo.git
    const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(s);
    if (!scp) return null;
    host = scp[1];
    rest = scp[2];
  }

  host = host.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  rest = rest.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = rest.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  return { host: host, owner: parts[0].toLowerCase(), repo: parts[1].toLowerCase() };
}

// Тот ли это репозиторий, куда «открой» имеет право писать.
export function isPublicOrigin(url) {
  const p = parseOrigin(url);
  return !!p && p.host === 'github.com' && p.owner === OPEN_OWNER && p.repo === OPEN_REPO;
}

// Проверка цели выкладки: origin — ровно alexshikaka/tapyor, ветка — main.
// Возвращает { ok } или { ok: false, why } с понятным текстом (его печатает open-release).
export function checkReleaseTarget(remote, branch) {
  const b = String(branch == null ? '' : branch).trim();
  if (b !== OPEN_BRANCH) {
    return { ok: false, why: 'Ветка «' + (b || '?') + '», а выкладывать можно только из ' + OPEN_BRANCH + '.' };
  }
  if (!isPublicOrigin(remote)) {
    return { ok: false, why: 'origin — не ' + OPEN_OWNER + '/' + OPEN_REPO + ' (получено: ' + (String(remote || '').trim() || 'пусто') + ').' };
  }
  return { ok: true };
}
