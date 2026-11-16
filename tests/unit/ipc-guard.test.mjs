// Страж IPC (стабилизация 12.11, B1): кто зовёт канал главного процесса.
// Главное правило: ошибка внутри проверки — это ОТКАЗ, а не пропуск вызова.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const guardModule = require('../../src/ipc-guard.js');

const OWN_URL = 'file:///home/user/app/src/index.html';
const ALIEN_URL = 'https://evil.example/';
const ownSender = { id: 'own-window' };
const alienSender = { id: 'alien-window' };
const ymWc = { id: 'ym-window', isDestroyed: () => false };

function make(overrides = {}) {
  const logs = [];
  const guard = guardModule.create({
    isOwnPage: (url) => url === OWN_URL,
    hasWindow: (sender) => sender === ownSender,
    ymwebContents: () => ymWc,
    log: (line) => logs.push(String(line)),
    ...overrides,
  });
  return { guard, logs };
}

test('своя страница проходит', () => {
  const { guard, logs } = make();
  assert.equal(guard.senderOk({ senderFrame: { url: OWN_URL }, sender: alienSender }, 'settings-get'), true);
  assert.deepEqual(logs, []);
});

test('чужая страница не проходит, даже если у отправителя есть окно', () => {
  const { guard, logs } = make();
  assert.equal(guard.senderOk({ senderFrame: { url: ALIEN_URL }, sender: ownSender }, 'settings-get'), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /отклонён/);
});

test('пустой адрес: с окном — проходит, без окна — нет', () => {
  const { guard } = make();
  assert.equal(guard.senderOk({ senderFrame: { url: '' }, sender: ownSender }, 'settings-get'), true);
  assert.equal(guard.senderOk({ sender: ownSender }, 'settings-get'), true);
  assert.equal(guard.senderOk({ senderFrame: { url: '' }, sender: alienSender }, 'settings-get'), false);
  assert.equal(guard.senderOk({ sender: alienSender }, 'settings-get'), false);
});

test('каналы окна Яндекса проходят только от его webContents', () => {
  const { guard } = make();
  const ev = (sender) => ({ senderFrame: { url: 'https://music.yandex.ru/' }, sender });
  assert.equal(guard.senderOk(ev(ymWc), 'ymweb-state'), true);
  assert.equal(guard.senderOk(ev(ymWc), 'ymweb-reply'), true);
  assert.equal(guard.senderOk(ev(alienSender), 'ymweb-state'), false);
  assert.equal(guard.senderOk(ev(alienSender), 'ymweb-reply'), false);
  // Другой канал от окна Яндекса — не исключение, отклоняем.
  assert.equal(guard.senderOk(ev(ymWc), 'ymweb-other'), false);
});

test('уничтоженное окно Яндекса не пускает', () => {
  const { guard } = make({ ymwebContents: () => ({ id: 'dead', isDestroyed: () => true }) });
  assert.equal(guard.senderOk({ senderFrame: { url: 'https://music.yandex.ru/' }, sender: { id: 'dead' } }, 'ymweb-state'), false);
});

test('isOwnPage бросает — отказ, а не пропуск (старая логика падала здесь)', () => {
  const { guard, logs } = make({
    isOwnPage: () => { throw new Error('сломанная проверка адреса'); },
  });
  assert.equal(guard.senderOk({ senderFrame: { url: OWN_URL }, sender: ownSender }, 'settings-get'), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /IPC: канал «settings-get» отклонён — ошибка проверки отправителя/);
});

test('hasWindow бросает — отказ', () => {
  const { guard } = make({
    hasWindow: () => { throw new Error('нет BrowserWindow'); },
  });
  assert.equal(guard.senderOk({ sender: ownSender }, 'settings-get'), false);
});

test('ymwebContents бросает — отказ', () => {
  const { guard } = make({
    ymwebContents: () => { throw new Error('окно Яндекса сломано'); },
  });
  assert.equal(guard.senderOk({ senderFrame: { url: 'https://music.yandex.ru/' }, sender: ymWc }, 'ymweb-state'), false);
});

test('ошибка проверки пишется в журнал не чаще раза в 10 с на канал', () => {
  const { guard, logs } = make({
    isOwnPage: () => { throw new Error('сломанная проверка адреса'); },
  });
  guard.senderOk({ senderFrame: { url: OWN_URL } }, 'first');
  guard.senderOk({ senderFrame: { url: OWN_URL } }, 'first');
  guard.senderOk({ senderFrame: { url: OWN_URL } }, 'first');
  assert.equal(logs.length, 1, 'три ошибки на один канал — одна строка');
  guard.senderOk({ senderFrame: { url: OWN_URL } }, 'second');
  assert.equal(logs.length, 2, 'на другой канал — своя строка');
});

test('ev без senderFrame и null не бросают', () => {
  const { guard } = make();
  assert.doesNotThrow(() => guard.senderOk({ sender: ownSender }, 'settings-get'));
  assert.equal(guard.senderOk({ sender: ownSender }, 'settings-get'), true);
  assert.doesNotThrow(() => guard.senderOk(null, 'settings-get'));
  assert.equal(guard.senderOk(null, 'settings-get'), false);
  assert.doesNotThrow(() => guard.senderOk({}, 'settings-get'));
  assert.equal(guard.senderOk({}, 'settings-get'), false);
});
