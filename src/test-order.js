'use strict';
// Тестовый заказ (0.34.0, шаг 3): выдуманный донат, который проходит ТОТ ЖЕ путь, что настоящий:
// сборка объекта здесь → onDonation → processDonation → requests.json → req-new → вкладка «Заказы».
// Деньги нигде не двигаются: к сервисам донатов запросов нет, это только пометка «тест».
// Чистая функция (без electron) — покрыта unit-тестом.

const SERVICES = ['da', 'dp'];
const DEFAULT_NAME = 'Тестовый зритель';
const DEFAULT_TEXT = 'Кино — Кукушка';
const DEFAULT_AMOUNT = 100;

function clampText(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// opts: { now, currency }. Поля — как у настоящего доната (src/donations.js daList/dpList),
// плюс test: true и service — только пометка для интерфейса.
function buildDonation(input, opts) {
  const o = input && typeof input === 'object' ? input : { text: input };
  const now = typeof (opts && opts.now) === 'function' ? opts.now() : Date.now();
  const currency = String((opts && opts.currency) || 'RUB').toUpperCase();
  const raw = Number(o.amount);
  const amount = isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
  const id = 't' + now.toString(36) + Math.random().toString(36).slice(2, 6);
  const service = SERVICES.indexOf(String(o.service || '')) >= 0 ? String(o.service) : 'da';
  return {
    prov: 'test',
    id: id,
    name: clampText(o.name, 80) || DEFAULT_NAME,
    text: clampText(o.text, 500),
    amount: amount,
    currency: currency,
    amountMain: amount,          // та же валюта, что в настройках, — пересчёт по курсу не нужен
    at: now,
    kind: 'text',
    test: true,
    service: service
  };
}

module.exports = { SERVICES, DEFAULT_NAME, DEFAULT_TEXT, DEFAULT_AMOUNT, buildDonation };
