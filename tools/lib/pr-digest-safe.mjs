// Экранирование сводки по чужим PR и хранение её состояния (аудит 0.34.0, A12).
//
// Заголовок, автор и имена файлов приходят из PR — это чужие данные. В Markdown они
// попадают только в `code`-спаны, а переводы строк, управляющие символы, обратные
// кавычки и угловые скобки убираются: иначе заголовок мог бы подделать разметку,
// «забыть предыдущие инструкции» или нарисовать ложный маркер состояния.
//
// Состояние сводки (что уже видели) больше не живёт в тексте сводки: оно лежит
// отдельным JSON-файлом рядом и проверяется по формату. Текст PR на него не влияет.
import fs from 'node:fs';
import path from 'node:path';

export const DIGEST_STATE_FILE = 'PR-DIGEST.state.json';

// Однострочный безопасный текст: без управляющих символов, переводов строк,
// обратных кавычек и угловых скобок (чтобы не вышло HTML-комментария).
export function plain(s, n) {
  let t = String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/`/g, "'")
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...t];
  if (n && chars.length > n) t = chars.slice(0, Math.max(0, n - 1)).join('') + '…';
  return t;
}

// Текст в `code`-спане: внутри него Markdown-символы (| * _ [ ]) безопасны.
export function codeSpan(s, n) {
  return '`' + plain(s, n) + '`';
}

// Путь файла состояния — рядом со сводкой (папка handoff, в git не попадает).
export function digestStatePath(outFile) {
  return path.join(path.dirname(String(outFile || '')), DIGEST_STATE_FILE);
}

function cleanMap(m) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const key of Object.keys(m)) {
    if (!Object.prototype.hasOwnProperty.call(m, key)) continue;
    const row = m[key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const clean = {};
    for (const n of Object.keys(row)) {
      if (!/^\d+$/.test(n)) continue;
      if (typeof row[n] === 'string') clean[n] = row[n].slice(0, 100);
    }
    out[String(key).slice(0, 200)] = clean;
  }
  return out;
}

function cleanIssues(m) {
  const out = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  for (const key of Object.keys(m)) {
    if (!Object.prototype.hasOwnProperty.call(m, key)) continue;
    const list = m[key];
    if (!Array.isArray(list)) continue;
    out[String(key).slice(0, 200)] = list.filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000);
  }
  return out;
}

// Проверка формата: только объект с prs/issues нужной формы; всё прочее — «состояния нет».
export function validDigestState(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return {
    at: typeof v.at === 'string' ? v.at.slice(0, 40) : '',
    prs: cleanMap(v.prs),
    issues: cleanIssues(v.issues),
  };
}

export function readDigestState(outFile) {
  try {
    const raw = fs.readFileSync(digestStatePath(outFile), 'utf8');
    return validDigestState(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export function writeDigestState(outFile, state) {
  const v = validDigestState(state) || { at: '', prs: {}, issues: {} };
  const file = digestStatePath(outFile);
  fs.writeFileSync(file, JSON.stringify(v, null, 2) + '\n', 'utf8');
  return file;
}
