// Описание релиза в открытом репозитории: «что нового» простыми словами + как скачать и поставить.
// Источник — CHANGELOG.md снимка (его собирает public-export из docs/releases/*/CHANGES.md).
// Чистая функция: покрыта tests/unit/release-notes.test.mjs.

const REPO = 'alexshikaka/tapyor';

// Раздел «## X.Y.Z» из CHANGELOG.md: текст до следующего «## » (без заголовка). Нет раздела — ''.
export function changelogSection(changelog, version) {
  const lines = String(changelog || '').replace(/\r\n/g, '\n').split('\n');
  const head = '## ' + version;
  const i = lines.findIndex((l) => l.trim() === head);
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  return lines.slice(i + 1, j).join('\n').trim();
}

export function releaseNotes({ changelog, tag, sha256 = '', commit = '', runUrl = '' }) {
  const version = String(tag || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('плохой тег: ' + tag);
  const exe = 'Tapyor-Setup-' + version + '.exe';
  const url = 'https://github.com/' + REPO + '/releases/download/v' + version + '/' + exe;
  const body = changelogSection(changelog, version);
  const out = [
    '## Скачать',
    '',
    '**[' + exe + '](' + url + ')** — Windows 10 и 11.',
    '',
    '- Тапёр уже стоит — он обновится сам (Настройки → Программа).',
    '- Windows покажет синее окно «Windows защитила ваш компьютер»: у установщика пока нет платной подписи.',
    '  Нажми «Подробнее» → «Выполнить в любом случае».',
    '',
    '## Что нового',
    '',
    body || 'Подробности — в [CHANGELOG.md](https://github.com/' + REPO + '/blob/main/CHANGELOG.md).',
    '',
    '---',
    ''
  ];
  const facts = [];
  if (sha256) facts.push('SHA-256 установщика: `' + sha256 + '`');
  if (commit) facts.push('собран из коммита `' + commit + '`' + (runUrl ? ' — [журнал сборки](' + runUrl + ')' : ''));
  if (facts.length) out.push(facts.join(' · '), '');
  out.push('Вопросы и ошибки — [Telegram-чат](https://t.me/tapyorchat) или [задачи](https://github.com/' + REPO + '/issues).');
  return out.join('\n') + '\n';
}
