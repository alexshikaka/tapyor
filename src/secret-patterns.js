'use strict';
// Один список «что считается ключом» — для выгрузки истории (вычистить), проверки репозитория (найти)
// и отчёта для проверки (скрыть). Инструменты в tools/ берут список отсюда, второй копии нет.
//
// Добавляешь новый сервис с ключом — добавь его шаблон сюда.
// Пары: [регулярное выражение, чем заменить]. Флаги у шаблонов глобальные — при повторном
// использовании создавайте копию через new RegExp(re.source, re.flags), как это делают tools.
const SECRET_PATTERNS = [
  [/GOCSPX-[A-Za-z0-9_-]+/g, '<REDACTED_GOOGLE_CLIENT_SECRET>'],
  [/[0-9]{6,}-[a-z0-9]+\.apps\.googleusercontent\.com/g, '<REDACTED_GOOGLE_CLIENT_ID>'],
  [/github_pat_[A-Za-z0-9_]+/g, '<REDACTED_GITHUB_TOKEN>'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '<REDACTED_GITHUB_TOKEN>'],
  [/AIza[0-9A-Za-z_-]{30,}/g, '<REDACTED_GOOGLE_API_KEY>'],
  [/\by0_[A-Za-z0-9_-]{20,}/g, '<REDACTED_YANDEX_TOKEN>'],
  [/\bAQAAAA[A-Za-z0-9_-]{20,}/g, '<REDACTED_YANDEX_TOKEN>'],
  // Last.fm, DonationAlerts, Telegram api_hash и т.п.: 32+ hex/латиница рядом со словом «key/secret/ключ/hash/token»
  [/((?:api[ _-]?key|shared[ _-]?secret|secret|client[ _-]?secret|api[ _-]?hash|token|ключ|секрет)[^\n]{0,40}?)\b[0-9a-f]{32}\b/gi, '$1<REDACTED_KEY>'],
  [/((?:client[ _-]?secret|api[ _-]?key|access[ _-]?token|секрет)["'\s:=]+)[A-Za-z0-9]{32,64}\b/gi, '$1<REDACTED_KEY>'],
  // Заголовки ответов и запросов (аудит 0.34.0, A4). Шаблоны сужены до «похоже на значение»,
  // чтобы не срабатывать на код вида Authorization: 'Bearer ' + token: там токена нет.
  [/(^|[\s"{,])(?:set-cookie|cookie)["']?\s*:\s*[^\r\n"',;]{6,}/gim, '$1<REDACTED_COOKIE>'],
  [/(^|[\s"{,])authorization["']?\s*:\s*(?:bearer\s+)?[A-Za-z0-9._~+/=-]{12,}/gim, '$1<REDACTED_AUTH>'],
  // Токены, которые узнаются по началу строки.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, '<REDACTED_TOKEN>'],
  [/\bya29\.[A-Za-z0-9._-]{8,}/g, '<REDACTED_GOOGLE_TOKEN>'],
  [/\bgho_[A-Za-z0-9_]{8,}/g, '<REDACTED_GITHUB_TOKEN>'],
  [/\b_gh_sess=[A-Za-z0-9%._~+/=-]+/gi, '<REDACTED_COOKIE>']
];
// Разрешённые публичные значения: только sha256 самого совпадения, без значений в коде.
// 810b… — публичный client_secret Яндекс Музыки (клиент без секрета, нужен для device-flow).
const ALLOWED_SECRET_HASHES = new Set([
  '810b34fb4d3e6cbbb1b4cb3ca397f2f389f83ba499098b9cfa1f0fbc4f262471'
]);

function redact(s, to) {
  const replacement = to === undefined ? undefined : to;
  return SECRET_PATTERNS.reduce(function (acc, p) {
    return String(acc).replace(p[0], replacement === undefined ? p[1] : replacement);
  }, String(s == null ? '' : s));
}

module.exports = { SECRET_PATTERNS, ALLOWED_SECRET_HASHES, redact };
