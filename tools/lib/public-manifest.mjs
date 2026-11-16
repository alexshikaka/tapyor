// Что меняется в служебных файлах ОТКРЫТОГО снимка (D2, находки F5/F6/F14/F15):
//   package.json     — лицензия MIT, поле repository, только публичные скрипты;
//   package-lock.json — корневой пакет тоже MIT (npm ci после этого не должен ругаться);
//   CHANGELOG.md     — мёртвые ссылки на внутренние файлы убираются, история помечается.
// Рабочие package.json/package-lock.json закрытого репозитория не трогаем — правки только в снимке.
// Чистые функции, чтобы покрыть тестами (tests/unit/public-manifest.test.mjs).

// Скрипты владельца: их цели (tools/*) в открытый снимок не попадают, значит и скриптов быть не должно.
export const INTERNAL_SCRIPTS = [
  'audit:pack',
  'audit:pack:history',
  'release:check',
  'history:export',
  'drill:make',
  'modules',
  'release:post'
];

export const OPEN_REPOSITORY = { type: 'git', url: 'https://github.com/alexshikaka/tapyor.git' };

// Пометка в начале CHANGELOG: старые записи — история, а не инструкция.
export const CHANGELOG_HISTORY_NOTE =
  'Записи ниже — история на момент выхода версии, а не инструкции. Внутренние документы автора ' +
  '(`docs/…`, `TODO.md`, `VERIFICATION.md`) и служебные команды, которых нет в этом репозитории, ' +
  'оставлены как исторические упоминания.';

export function sanitizePackageJson(pj) {
  const j = JSON.parse(JSON.stringify(pj));
  j.license = 'MIT';
  j.repository = { ...OPEN_REPOSITORY };
  if (j.scripts) for (const name of INTERNAL_SCRIPTS) delete j.scripts[name];
  return j;
}

export function sanitizeLock(lock) {
  const j = JSON.parse(JSON.stringify(lock));
  if (j.packages && j.packages['']) j.packages[''].license = 'MIT';
  if (Object.prototype.hasOwnProperty.call(j, 'license')) j.license = 'MIT';
  return j;
}

// Ссылка в снимке: внешнюю и якорную не трогаем, локальную без файла — оставляем текстом.
const LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function stripDeadLinks(markdown, exists) {
  return String(markdown).split('\n').map((line) => line.replace(LINK, (all, text, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) return all;
    const rel = target.split('#')[0].split('?')[0].replace(/\\/g, '/').replace(/^\.\//, '');
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) return all;
    return exists(rel) ? all : text;
  })).join('\n');
}
