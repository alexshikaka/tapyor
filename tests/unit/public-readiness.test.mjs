// Готовность открытого снимка (D2): документы и CI не должны ссылаться на внутренние файлы,
// которых в снимке нет, и обещать несуществующие скрипты (F7–F11, F13).
// Списки «что публично» — tools/lib/pr-paths.mjs, один источник правды с public-export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublic, DOCS_PUBLIC } from '../../tools/lib/pr-paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Документы, которые читает посторонний. У части из них открытая версия лежит в public/.
const PUBLIC_DOCS = ['README.md', 'PRIVACY.md', 'SECURITY.md', 'THIRD-PARTY.md'].concat([...DOCS_PUBLIC]);

function docPath(rel) {
  const overlay = path.join(ROOT, 'public', rel);
  if (fs.existsSync(overlay)) return overlay;
  return path.join(ROOT, rel);
}

const HAS_PUBLIC = fs.existsSync(path.join(ROOT, 'public'));
// Файл попадёт в снимок, если он публичен по спискам ИЛИ лежит поверх в public/.
// В самом снимке папки public/ уже нет: там «в снимке» = файл просто существует на своём месте.
const inSnapshot = (rel) => isPublic(rel)
  || fs.existsSync(path.join(ROOT, 'public', rel))
  || (!HAS_PUBLIC && fs.existsSync(path.join(ROOT, rel)));

function scriptTarget(name) {
  const cmd = PACKAGE.scripts && PACKAGE.scripts[name];
  if (!cmd) return null;
  const m = cmd.match(/node\s+([^\s&|]+)/);
  return m ? m[1] : null;
}

// В рабочем репозитории CI лежит в public/, в снимке public/ уже нет — файлы на своих местах.
function ciDir() {
  const overlay = path.join(ROOT, 'public', '.github', 'workflows');
  return fs.existsSync(overlay) ? overlay : path.join(ROOT, '.github', 'workflows');
}

test('публичные документы: markdown-ссылки ведут на файлы снимка', () => {
  const bad = [];
  for (const doc of PUBLIC_DOCS) {
    const file = docPath(doc);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const t = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('#') || t.startsWith('//')) continue;
      const rel = t.split('#')[0].split('?')[0].replace(/\\/g, '/').replace(/^\.\//, '');
      if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) continue;
      if (!inSnapshot(rel)) bad.push(doc + ' → ' + t);
    }
  }
  assert.deepEqual(bad, [], 'ссылки на файлы, которых в снимке нет:\n' + bad.join('\n'));
});

test('публичные документы: упоминания файлов проекта — только публичные', () => {
  const TOKEN = /^(?:docs|src|tests|tools|resources|modules|server|public)\/[A-Za-z0-9_.\-/]+$/;
  const bad = [];
  for (const doc of PUBLIC_DOCS) {
    const file = docPath(doc);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1].trim();
      if (!TOKEN.test(token)) continue;
      const probe = token.endsWith('/') ? token + 'x' : token;
      if (!inSnapshot(probe)) bad.push(doc + ' → ' + token);
    }
  }
  assert.deepEqual(bad, [], 'упоминания внутренних файлов:\n' + bad.join('\n'));
});

test('публичные документы: npm run вызывает только скрипты снимка', () => {
  const bad = [];
  for (const doc of PUBLIC_DOCS) {
    const file = docPath(doc);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/npm run ([\w:.-]+)/g)) {
      const name = m[1];
      const target = scriptTarget(name);
      if (!PACKAGE.scripts || !PACKAGE.scripts[name]) bad.push(doc + ' → npm run ' + name + ' (скрипта нет)');
      else if (target && !inSnapshot(target)) bad.push(doc + ' → npm run ' + name + ' (цель ' + target + ' не в снимке)');
    }
  }
  assert.deepEqual(bad, [], 'команды, которых в снимке не будет:\n' + bad.join('\n'));
});

test('CI открытого репозитория: только существующие публичные файлы и скрипты', () => {
  const dir = ciDir();
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/node\s+([\w./\\-]+\.mjs)/g)) {
      const rel = m[1].replace(/\\/g, '/');
      if (!inSnapshot(rel)) bad.push(f + ' → node ' + rel);
    }
    for (const m of text.matchAll(/npm run ([\w:.-]+)/g)) {
      const name = m[1];
      if (!PACKAGE.scripts || !PACKAGE.scripts[name]) bad.push(f + ' → npm run ' + name + ' (скрипта нет)');
    }
  }
  assert.deepEqual(bad, [], 'CI зовёт то, чего в снимке нет:\n' + bad.join('\n'));
});

test('CI открытого репозитория: нет шага про удалённый вход ЮMoney (F9)', () => {
  const dir = ciDir();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /yoomoney|YOO_CLIENT_ID/i, f + ': остался шаг ЮMoney');
  }
});

test('GEMINI.md — инструкция для ИИ-помощника, в снимок не попадает (F10)', () => {
  assert.equal(isPublic('GEMINI.md'), false);
});

test('SKINS.md указывает настоящие файлы данных и функций оболочек (F7)', () => {
  const text = fs.readFileSync(docPath('docs/SKINS.md'), 'utf8');
  assert.doesNotMatch(text, /Данные \(в `src\/index\.html`/, 'данные схем — не в index.html');
  assert.doesNotMatch(text, /Функции \(все в `src\/index\.html`\)/, 'функции — не в index.html');
  assert.match(text, /src\/skins\/skins-pack\.js/);
  assert.match(text, /src\/ui\/01-skins\.js/);
});

test('BOT-GUIDE и README говорят одно и то же про пробный период (F11)', () => {
  const bot = fs.readFileSync(docPath('docs/BOT-GUIDE.md'), 'utf8');
  const readme = fs.readFileSync(docPath('README.md'), 'utf8');
  assert.doesNotMatch(bot, /Позже он станет частью платного пака/, 'устаревшее «позже»');
  assert.match(bot, /30 дней/, 'сказано про бесплатные 30 дней');
  assert.match(readme, /30 дней/i, 'README тоже про 30 дней');
});

test('README называет заметные функции: Streamer.bot, подпись обновлений, tapyor debug (F13)', () => {
  const readme = fs.readFileSync(docPath('README.md'), 'utf8');
  assert.match(readme, /Streamer\.bot/);
  assert.match(readme, /подпис/i);
  assert.match(readme, /tapyor debug/);
});

test('снимки инструкции Streamer.bot уходят в снимок вместе с ней, остальные картинки docs/ — нет', async () => {
  const { isPublic: pub } = await import('../../tools/lib/pr-paths.mjs');
  assert.equal(pub('docs/STREAMERBOT-GUIDE.md'), true);
  assert.equal(pub('docs/img/streamerbot/sb-01-connect.png'), true);
  assert.equal(pub('docs/img/streamerbot/../secret.png'), false);
  assert.equal(pub('docs/img/mockup.png'), false);
});
