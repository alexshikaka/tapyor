// TAP-08: скрытое окно сайта Яндекса — какие адреса считаются «своими».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return { BrowserWindow: function () {}, ipcMain: { on() {}, handle() {} } }; return orig.call(this, r, ...a); };
const ymweb = require('../../src/ymweb.js');
Module._load = orig;
const ok = ymweb._navAllowed;

test('свои адреса Яндекса', () => {
  for (const u of ['https://music.yandex.ru/album/1/track/2', 'https://passport.yandex.ru/auth', 'https://yandex.kz/', 'https://ya.ru', 'https://sso.ya.ru/x', 'https://music.yandex.com.tr/']) assert.equal(ok(u), true, u);
});
test('чужие и обманные адреса', () => {
  for (const u of ['https://evil.com/', 'https://yandex.ru.evil.com/', 'https://notyandex.ru/', 'http://music.yandex.ru/', 'file:///tmp/x', 'https://id.vk.com/auth', 'javascript:alert(1)']) assert.equal(ok(u), false, u);
});
