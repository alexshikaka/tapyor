// docs/PR-LOG.md — журнал решений по чужим PR. Только закрытый репозиторий (docs/ в снимок не идёт).
// Пишет tools/import-pr.mjs после переноса; версию ставит tools/open-release.mjs после «открой X.Y.Z».
import fs from 'node:fs';
import path from 'node:path';

export const PR_LOG_REL = 'docs/PR-LOG.md';

const HEADER = `# Журнал чужих PR (только закрытый репозиторий)

Порядок приёма — \`docs/PR-RULES.md\`. Строка появляется после решения; колонка «Версия» заполняется
командой «открой X.Y.Z» (\`tools/open-release.mjs\`), когда правка вошла в открытую сборку.
Описания и комментарии PR сюда не копируются — только номер, автор, решение и коммит.

| PR | Автор | Дата | Решение | Коммит | Решил | Версия |
|---|---|---|---|---|---|---|
`;

export const prLogFile = (root) => path.join(root, PR_LOG_REL);

const cell = (v) => String(v == null ? '' : v).replace(/[|\r\n]+/g, ' ').trim();
const rowLine = (r) => '| #' + cell(r.number) + ' | ' + cell(r.author) + ' | ' + cell(r.date) + ' | '
  + cell(r.decision) + ' | ' + cell(r.commit || '—') + ' | ' + cell(r.decidedBy) + ' | ' + cell(r.version || '—') + ' |';

export function readPrLog(root) {
  const file = prLogFile(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((l) => /^\|\s*#\d+\s*\|/.test(l))
    .map((l) => {
      const c = l.split('|').slice(1, -1).map((x) => x.trim());
      return {
        number: Number(String(c[0] || '').replace('#', '')), author: c[1] || '', date: c[2] || '',
        decision: c[3] || '', commit: c[4] || '', decidedBy: c[5] || '', version: c[6] || '',
      };
    });
}

export function ensurePrLog(root) {
  const file = prLogFile(root);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, HEADER, 'utf8');
  }
  return file;
}

// Добавить или заменить строку PR (повторный перенос того же номера не плодит строки).
export function addPrLogRow(root, row) {
  const file = ensurePrLog(root);
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => new RegExp('^\\|\\s*#' + Number(row.number) + '\\s*\\|').test(l));
  const line = rowLine(row);
  if (idx >= 0) lines[idx] = line;
  else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(line, '');
  }
  fs.writeFileSync(file, lines.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
  return line;
}

// Поставить версию в строке PR (после «открой X.Y.Z»). false — строки нет.
export function setPrLogVersion(root, number, version) {
  const file = prLogFile(root);
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const re = new RegExp('^\\|\\s*#' + Number(number) + '\\s*\\|');
  const idx = lines.findIndex((l) => re.test(l));
  if (idx < 0) return false;
  const c = lines[idx].split('|').slice(1, -1).map((x) => x.trim());
  c[c.length - 1] = cell(version);
  lines[idx] = '| ' + c.join(' | ') + ' |';
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return true;
}
