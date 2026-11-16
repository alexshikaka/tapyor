'use strict';
// Сборщик отчёта для проверки: текст журнала + состояние + настройки → один текстовый файл.
// Этим же сборщиком потом будет пользоваться «Сообщить об ошибке» (0.34.1), поэтому здесь только
// чистая логика: ни Electron, ни DOM, ни записи на диск. Сохранение — в main.js.
//
// Правила отчёта (решение владельца):
//  - ники зрителей и тексты заказов остаются КАК ЕСТЬ;
//  - ключей, токенов, cookies и паролей — никогда: сначала выкидываем поля с такими именами,
//    затем ВЕСЬ итоговый текст прогоняем по шаблонам секретов и заменяем совпадения на «[скрыто]»;
//  - путь C:\Users\<имя> сокращаем до C:\Users\… (как reportScrub в main.js).
//  - файл никуда не отправляется сам: его сохраняет человек через «Сохранить как».

const { SECRET_PATTERNS } = require('./secret-patterns');

const STATE_LABELS = {
  version: 'Версия',
  build: 'Сборка',
  commit: 'Коммит',
  channel: 'Канал обновлений',
  license: 'Лицензия пака',
  pack: 'Пак стримера',
  modules: 'Модули',
  logins: 'Входы в сервисы',
  autofix: 'Автопочинок за сессию',
  load: 'Нагрузка',
  dataDir: 'Папка данных',
  verbose: 'Подробный журнал на эту сессию'
};
const STATE_ORDER = ['version', 'build', 'commit', 'channel', 'license', 'pack', 'modules', 'logins', 'autofix', 'load', 'dataDir', 'verbose'];
const SERVICE_LABELS = {
  youtube: 'YouTube',
  yandex: 'Яндекс Музыка',
  donationalerts: 'DonationAlerts',
  donatepay: 'DonatePay',
  twitch: 'Twitch',
  lastfm: 'Last.fm',
  github: 'GitHub'
};
const MODULE_LABELS = { bot: 'Чат-бот', overlay: 'Оверлей-плейлист' };

// Имена полей, которые нельзя писать в отчёт целиком. Сравниваем по частям имени:
// hotkeys — это не «key», а modSecure.streamer-pack.core.licenseKey — да.
const SECRET_PARTS = new Set([
  'token', 'tokens', 'key', 'keys', 'secret', 'secrets', 'cookie', 'cookies',
  'password', 'passwd', 'sapisid', 'sid', 'auth', 'oauth', 'authorization', 'credential', 'credentials',
  'license', 'licenses', 'hash', 'salt', 'signature'
]);

// Поля-пути (аудит 0.34.0, A6): в плейлистах и библиотеке они выдают структуру папок.
// Само имя поля в отчёте остаётся (видно, что настройка есть), значения — нет.
const PATH_FIELDS = new Set(['path', 'folder', 'file', 'dir']);

function nameParts(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^0-9A-Za-zА-Яа-яЁё]+/)
    .filter(Boolean);
}

function isSecretField(name) {
  const s = String(name || '');
  if (!s) return false;
  if (/^modSecure($|\.)/i.test(s)) return true;              // секреты модулей (в т.ч. ключ покупки)
  if (/^sbotSecure($|\.)/i.test(s)) return true;             // ключ и пароль пульта Streamer.bot (0.35)
  if (s === 'modLicenseKey' || s === 'modLicenses') return true; // токены лицензий пака
  const low = s.toLowerCase();
  if (low.includes('sapisid')) return true;
  if (/apikey|api_key|accesskey|access_key/i.test(s)) return true;
  if (/(^|[._-])(token|secret|cookie|password|passwd|auth|credential|license)([._-]|$)/i.test(s)) return true;
  return nameParts(s).some(function (part) { return SECRET_PARTS.has(part.toLowerCase()); });
}

// Поле-путь: path / folder / file / dir в любом регистре и на любой глубине.
function isPathField(name) {
  return PATH_FIELDS.has(String(name || '').toLowerCase());
}

// Убираем секретные поля на любой глубине. Массивы обходим, остальные значения не трогаем:
// в них могут быть ники и тексты заказов, а их портить нельзя.
function scrubSettings(value) {
  if (Array.isArray(value)) return value.map(scrubSettings);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (k) {
      if (isSecretField(k) || isPathField(k)) return;
      out[k] = scrubSettings(value[k]);
    });
    return out;
  }
  return value;
}

function clock(ts) {
  const n = Number(ts);
  if (!isFinite(n) || n <= 0) return '—';
  const d = new Date(n);
  const two = function (x) { return x < 10 ? '0' + x : String(x); };
  return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

function yesNo(v) { return v ? 'есть' : 'нет'; }

function moduleLine(modules) {
  if (!modules || typeof modules !== 'object') return '—';
  const parts = Object.keys(modules).map(function (id) {
    const n = MODULE_LABELS[id] || id;
    return n + ' — ' + (modules[id] ? 'запущен' : 'не запущен');
  });
  return parts.length ? parts.join('; ') : 'модулей нет';
}

function loginsBlock(logins) {
  if (!logins || typeof logins !== 'object') return '—';
  const keys = Object.keys(SERVICE_LABELS).filter(function (k) { return k in logins; })
    .concat(Object.keys(logins).filter(function (k) { return !(k in SERVICE_LABELS); }));
  if (!keys.length) return '—';
  return '\n' + keys.map(function (k) {
    return '  ' + (SERVICE_LABELS[k] || k) + ': ' + yesNo(logins[k]);
  }).join('\n');
}

function autofixBlock(autofix) {
  if (!autofix || typeof autofix !== 'object') return '—';
  const keys = Object.keys(SERVICE_LABELS).filter(function (k) { return k in autofix; })
    .concat(Object.keys(autofix).filter(function (k) { return !(k in SERVICE_LABELS); }));
  if (!keys.length) return '—';
  return '\n' + keys.map(function (k) {
    return '  ' + (SERVICE_LABELS[k] || k) + ': ' + (Number(autofix[k]) || 0);
  }).join('\n');
}

function loadBlock(load) {
  if (!load || typeof load !== 'object') return '—';
  const out = [];
  out.push('замер: ' + (load.watch ? 'включён' : 'выключен в настройках'));
  if (load.current) {
    out.push('сейчас: память ' + (load.current.mem == null ? '—' : Math.round(load.current.mem) + ' МБ')
      + ', ЦП ' + (load.current.cpu == null ? '—' : Number(load.current.cpu).toFixed(1).replace('.', ',') + ' %')
      + ' (' + clock(load.current.at) + ')');
  }
  if (load.peaks) {
    out.push('пик памяти: ' + (load.peaks.mem == null ? '—' : Math.round(load.peaks.mem) + ' МБ') + ' в ' + clock(load.peaks.memAt));
    out.push('пик ЦП: ' + (load.peaks.cpu == null ? '—' : Number(load.peaks.cpu).toFixed(1).replace('.', ',') + ' %') + ' в ' + clock(load.peaks.cpuAt));
  }
  return '\n  ' + out.join('\n  ');
}

function formatValue(key, v) {
  if (key === 'modules') return moduleLine(v);
  if (key === 'logins') return loginsBlock(v);
  if (key === 'autofix') return autofixBlock(v);
  if (key === 'load') return loadBlock(v);
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (v == null || v === '') return '—';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return '—'; }
  }
  return String(v);
}

function stateText(state) {
  if (!state || typeof state !== 'object') return 'Нет данных.';
  const keys = STATE_ORDER.filter(function (k) { return k in state; })
    .concat(Object.keys(state).filter(function (k) { return STATE_ORDER.indexOf(k) < 0 && k !== 'buildText' && k !== 'channelText'; }));
  const lines = [];
  keys.forEach(function (k) {
    let v = state[k];
    if (k === 'build' && state.buildText) v = state.buildText;
    if (k === 'channel' && state.channelText) v = state.channelText;
    lines.push((STATE_LABELS[k] || k) + ': ' + formatValue(k, v));
  });
  return lines.join('\n');
}

function settingsText(settings) {
  let clean;
  try { clean = scrubSettings(settings || {}); }
  catch (e) { return 'Настройки не удалось прочитать: ' + (e && e.message ? e.message : e); }
  try { return JSON.stringify(clean, null, 2); }
  catch (e) { return 'Настройки не удалось записать: ' + (e && e.message ? e.message : e); }
}

// Пути пользователя — как reportScrub в main.js. В блоке настроек текст уже
// в JSON, поэтому обратные слэши там удвоены (C:\\Users\\Имя): ловим и такой вид,
// иначе имя пользователя из путей настроек попадало бы в отчёт.
// Имя Windows может быть с пробелом («John Doe») — поэтому без \s в конце.
function scrubUserPaths(text) {
  return String(text == null ? '' : text)
    .replace(/([A-Za-z]:)(\\+)Users\2([^\\\r\n"'<>|]+)/gi, function (m, drive, sep) {
      return drive + sep + 'Users' + sep + '…';
    })
    .replace(/\/(home|Users)\/[^/\r\n"'<>|]+/g, '/$1/…');
}

// Любой абсолютный путь Windows → <путь> (аудит 0.34.0, A6): D:\Music\…, C:\\Users\\…
// в JSON, UNC \\server\share\… Куски после пути до кавычки/конца строки не трогаем, чтобы
// не портить текст настройки.
function scrubWinPaths(text) {
  return String(text == null ? '' : text)
    .replace(/[A-Za-z]:\\[^"\r\n]*/g, '<путь>')
    .replace(/\\\\[^\s"']+\\[^"\r\n]*/g, '<путь>');
}

// Заголовки Cookie / Set-Cookie / Authorization (аудит 0.34.0, A4): вырезаем целиком —
// в любом регистре и в любом месте строки. Запись журнала может быть JSON-строкой,
// поэтому заголовок и его значение убираем до конца строки: лучше потерять хвост записи,
// чем отправить чужой cookie или токен.
const HEADER_RX = /(^|[\s"{,])(?:set-cookie|cookie|authorization)["']?\s*:[^\r\n]*/gim;
function scrubHeaders(text) {
  return String(text == null ? '' : text).replace(HEADER_RX, '$1[скрыто]');
}

// Совпадения шаблонов секретов — целиком в «[скрыто]». Копии регулярных выражений создаём,
// чтобы не зависеть от lastIndex глобальных шаблонов.
function scrubSecrets(text) {
  return SECRET_PATTERNS.reduce(function (acc, p) {
    return acc.replace(new RegExp(p[0].source, p[0].flags), '[скрыто]');
  }, String(text == null ? '' : text));
}

// Адрес с параметрами (B7b, P5b L1): оставляем только схему и хост. В query часто лежат
// токены и ключи; путь без параметров не трогаем — он не выдаёт лишнего.
function scrubUrls(text) {
  return String(text == null ? '' : text).replace(/https?:\/\/[^\s"'<>]+/gi, function (m) {
    let u;
    try { u = new URL(m); } catch (e) { return '<адрес>'; }
    if (u.search || u.hash) return u.protocol + '//' + u.host;
    return m;
  });
}

function buildReport(o) {
  o = o || {};
  const now = o.now ? new Date(o.now) : new Date();
  const two = function (x) { return x < 10 ? '0' + x : String(x); };
  const stamp = now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate())
    + ' ' + two(now.getHours()) + ':' + two(now.getMinutes()) + ':' + two(now.getSeconds());
  const log = String(o.log == null ? '' : o.log);
  // «Состояние»: папка данных Тапёра остаётся сокращённой (путь пользователя), а не <путь> —
  // владельцу нужно видеть, какой профиль открыт. Везде ещё абсолютные пути скрываем.
  const statePart = scrubUserPaths(stateText(o.state));
  const settingsPart = scrubWinPaths(scrubUserPaths(settingsText(o.settings)));
  const logPart = scrubWinPaths(scrubUserPaths(log || '(журнал пуст)'));
  const text = [
    'Тапёр — отчёт для проверки',
    'Собран: ' + stamp,
    'Собран вручную в отладочном меню. Сам никуда не отправляется.',
    '',
    '## Состояние',
    statePart,
    '',
    '## Настройки',
    settingsPart,
    '',
    '## Журнал',
    logPart,
    ''
  ].join('\n');
  return scrubSecrets(scrubHeaders(scrubUrls(text)));
}

module.exports = { buildReport, scrubSettings, scrubUserPaths, scrubWinPaths, scrubSecrets, scrubHeaders, scrubUrls, isSecretField, isPathField, stateText };
