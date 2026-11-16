'use strict';
// Проверка облачных функций Тапёра (Yandex Cloud Functions: yc-da, yc-google, yc-report).
// Запрос GET с общим ключом: функция отвечает «405 только POST» — значит, облако её запускает и ключ принят.
// Внешние сервисы (DonationAlerts, Google, GitHub) при этом не трогаются; один вызов на функцию — копейки
// от бесплатного миллиона. Ответ облака переводится в понятную причину и место, куда смотреть.
const fs = require('fs');
const path = require('path');

const BILLING = 'https://center.yandex.cloud/billing/accounts';
const CONSOLE = 'https://console.yandex.cloud';
const NAMES = { da: 'донаты (DonationAlerts)', google: 'вход YouTube через Google', report: 'отчёты об ошибках' };

// Что значит ответ и куда смотреть. kind: ok | key | billing | quota | missing | error | net
const KINDS = {
  ok: { state: 'ok', text: 'работает' },
  key: { state: 'bad', text: 'облако не приняло ключ Тапёра', where: 'Функция отклоняет общий ключ: в облаке SHARED_KEY другой, чем в этой версии Тапёра. Консоль → Cloud Functions → функция → «Редактор» → переменные окружения.', link: CONSOLE },
  billing: { state: 'bad', text: 'облако отказало — похоже, оплата', where: 'Скорее всего, кончился бесплатный уровень или платёжный аккаунт заблокирован. Биллинг → платёжный аккаунт → «Детализация» и статус аккаунта.', link: BILLING },
  quota: { state: 'warn', text: 'слишком много запросов', where: 'Облако притормаживает вызовы (лимит или квота). Консоль → Cloud Functions → функция → «Мониторинг»: нет ли всплеска вызовов.', link: CONSOLE },
  missing: { state: 'bad', text: 'функция не найдена', where: 'Адрес функции не отвечает: её удалили или сменился адрес. Консоль → Cloud Functions — есть ли функция и совпадает ли адрес.', link: CONSOLE },
  error: { state: 'bad', text: 'ошибка внутри функции', where: 'Функция запустилась и упала. Консоль → Cloud Functions → функция → «Логи».', link: CONSOLE },
  net: { state: 'warn', text: 'не отвечает', where: 'Нет ответа от облака: интернет, VPN или сбой Яндекса. Если Интернет в проверке зелёный — status.yandex.cloud.', link: 'https://status.yandex.cloud' },
};

// status — HTTP-код, body — текст ответа (может быть пустым), err — исключение сети
function classify(status, body, err) {
  if (err || !status) return 'net';
  let j = null; try { j = JSON.parse(body || ''); } catch (e) {}
  const ours = j && typeof j.error === 'string';
  const txt = String(body || '').toLowerCase();
  if (status === 405 && ours) return 'ok';
  if (status === 403 && ours && j.error === 'forbidden') return 'key';
  if (status === 402 || /billing|payment|suspend|blocked|баланс|оплат|заблок/.test(txt)) return 'billing';
  if (status === 403) return 'billing'; // 403 не от нашей функции — отказ самого облака
  if (status === 429) return 'quota';
  if (status === 404) return 'missing';
  if (status >= 500) return 'error';
  if (status >= 200 && status < 500) return 'ok'; // ответила функция — значит, живая
  return 'error';
}

function readProxy(file) {
  for (const p of [path.join(__dirname, file), path.join(process.resourcesPath || '', file)]) {
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); if (j && j.proxyUrl) return j.proxyUrl; } catch (e) {}
  }
  return '';
}

// targets: [{ id, url }]; fetch(url, opts) → { status, text() }
async function check(targets, o) {
  const out = [];
  await Promise.all(targets.filter((t) => t.url).map(async (t) => {
    let status = 0, body = '', err = null;
    try {
      const r = await o.fetch(t.url, { method: 'GET', headers: { [o.keyHeader]: o.key }, signal: AbortSignal.timeout(o.timeoutMs || 8000) });
      status = r.status; body = await r.text().catch(() => '');
    } catch (e) { err = e; }
    const kind = classify(status, body, err);
    out.push(Object.assign({ id: t.id, name: NAMES[t.id] || t.id, kind, status }, KINDS[kind]));
  }));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Сводка для строки быстрой проверки
function summary(list) {
  if (!list.length) return { state: 'off', text: 'не настроены (сборка без облака)' };
  const bad = list.filter((x) => x.kind !== 'ok');
  if (!bad.length) return { state: 'ok', text: 'все ' + list.length + ' на связи' };
  const worst = bad.some((x) => x.state === 'bad') ? 'bad' : 'warn';
  return {
    state: worst,
    text: bad.map((x) => x.name + ': ' + x.text).join(' · '),
    details: bad.map((x) => x.name + ' — ' + x.where + ' ' + x.link + (x.status ? ' (HTTP ' + x.status + ')' : '')).join('\n'),
    where: bad.map((x) => ({ name: x.name, text: x.where, link: x.link })),
  };
}

module.exports = { classify, check, summary, readProxy, KINDS, BILLING, CONSOLE };
