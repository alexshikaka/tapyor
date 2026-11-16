// Мост ядра для модуля пака «Пульт с телефона» (docs/REMOTE.md, «Как устроено», п. 1).
// Отдаёт модулю три вещи и ничего больше:
//   dock — узел второй док-панели (hub.forModule(id) как есть);
//   feed — лента первой панели (/widget): состояние, зритель, нажатия, тумблер «Точные»;
//   qr   — SVG-код для телефона.
// Без require('electron'): всё внешнее приходит в create({ hub, widget, qrSvg, log }).
'use strict';

const ALLOWED_KEYS = new Set(['rq', 'ri', 'id', 'act', 'ix']);
// Что реально бывает у карточек ленты (src/ui/10-requests.js → rqCardHtml):
// add, now, alts, link, skip, reparse. find/textfind/settings открывают окно — не пропускаем.
const ALLOWED_RQ = new Set(['add', 'now', 'alts', 'link', 'skip', 'reparse']);
const MAX_VALUE = 80;

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// dataset из окна ленты: только известные ключи, только строки до 80 знаков,
// действие — из белого списка. Возвращает новый объект или null.
function cleanDataset(obj) {
  if (!isPlainObject(obj)) return null;
  const out = {};
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) return null;
    const v = obj[key];
    if (typeof v !== 'string' || v.length > MAX_VALUE) return null;
    out[key] = v;
  }
  if (!out.rq || !ALLOWED_RQ.has(out.rq)) return null;
  return out;
}

// SVG-код: qrcode-svg (MIT, уже есть в ядре), ecl M, 256 px, без <?xml (как src/sitepage.js → qrSvg).
function makeQr(text) {
  try {
    const QRCode = require('qrcode-svg');
    const svg = new QRCode({
      content: String(text || ''), width: 256, height: 256,
      color: '#111111', background: '#ffffff', ecl: 'M', padding: 4, join: true, container: 'svg-viewbox' // viewBox: окно уменьшает код до 220 px — без него обрезался край; padding — белое поле для камеры
    }).svg();
    return String(svg).replace(/^<\?xml[^>]*\?>\s*/i, '');
  } catch (e) {
    return '';
  }
}

function create(ctx) {
  const { hub, widget, qrSvg, log, relays } = ctx || {};
  // Адреса облака пульта — из ядра (src/remote-server.json), а не из открытого репозитория пака (16.11)
  const relayList = Array.isArray(relays) ? relays.filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 4) : [];
  const widgetApi = widget || {};
  const logFn = typeof log === 'function' ? log : () => {};
  const wanters = new Set();   // id модулей, попросивших ленту: каждый — зритель первой панели

  // Число зрителей первой панели = открытые /widget + модули с want(true).
  function syncWanters() {
    if (typeof widgetApi.setWidgetExtra !== 'function') return;
    try { widgetApi.setWidgetExtra(wanters.size); } catch (e) { /* сервер ещё поднимается */ }
  }

  function forModule(id) {
    const key = String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'module';

    return {
      // Куда ходить через интернет: облака пульта по порядку (основное, запасные)
      relays: relayList.slice(),
      // Снимок пульта, команды и поиск — ровно то, что даёт узел второй панели.
      dock: hub && typeof hub.forModule === 'function' ? hub.forModule(key) : undefined,

      feed: {
        // fn получает тот же объект widgetState, что и страница /widget; сразу — последний.
        on(fn) {
          if (typeof fn !== 'function') return () => {};
          if (typeof widgetApi.widgetState === 'function') {
            try {
              const st = widgetApi.widgetState();
              if (st) fn(st);
            } catch (e) { /* подписчик сломался — отписка всё равно нужна */ }
          }
          return typeof widgetApi.onWidgetState === 'function' ? widgetApi.onWidgetState(fn) : () => {};
        },

        // Хочу ленту: окно начинает собирать её, как при открытой /widget.
        want(on) {
          if (on) wanters.add(key);
          else wanters.delete(key);
          syncWanters();
        },

        // Нажатие в ленте: как POST /widget/rq, но окно не поднимаем (focus: false).
        rq(dataset) {
          const d = cleanDataset(dataset);
          if (!d) return { ok: false, error: 'bad-dataset' };
          if (typeof widgetApi.widgetSend !== 'function') return { ok: false, error: 'no-widget' };
          try {
            widgetApi.widgetSend('widget-rq', { dataset: d, focus: false });
            logFn('пульт: лента ' + d.rq);
            return { ok: true };
          } catch (e) {
            return { ok: false, error: 'send' };
          }
        },

        // Тумблер ленты: только разрешённые ключи, дальше — как POST /widget/setting.
        setting(name, value) {
          if (typeof name !== 'string' || !name) return { ok: false, error: 'bad-setting' };
          if (typeof widgetApi.widgetSetting !== 'function') return { ok: false, error: 'no-widget' };
          try {
            const ok = !!widgetApi.widgetSetting(name, value);
            if (ok) logFn('пульт: настройка ' + name);
            return { ok };
          } catch (e) {
            return { ok: false, error: 'setting' };
          }
        }
      },

      qr(text) {
        if (typeof qrSvg === 'function') {
          try { return String(qrSvg(String(text || '')) || ''); } catch (e) { return ''; }
        }
        return makeQr(text);
      }
    };
  }

  return {
    forModule,
    wanters: () => wanters.size
  };
}

module.exports = { create, cleanDataset, ALLOWED_RQ, ALLOWED_KEYS };
