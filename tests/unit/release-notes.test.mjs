import test from 'node:test';
import assert from 'node:assert';
import { changelogSection, releaseNotes } from '../../tools/lib/release-notes.mjs';

const LOG = [
  '# Что менялось в Тапёре', '',
  '## 0.37.0', '', 'Главное — знакомство.', '', '### Оформление', '', '1. Восемь тем.', '',
  '## 0.36.4', '', 'Стабилизация.', ''
].join('\r\n');

test('раздел версии — до следующей версии, подзаголовки внутри остаются', () => {
  const s = changelogSection(LOG, '0.37.0');
  assert.match(s, /^Главное — знакомство\./);
  assert.match(s, /### Оформление/);
  assert.doesNotMatch(s, /Стабилизация/);
  assert.equal(changelogSection(LOG, '0.36.4'), 'Стабилизация.');
  assert.equal(changelogSection(LOG, '9.9.9'), '');
});

test('описание: ссылка на установщик, SmartScreen, что нового, SHA-256', () => {
  const n = releaseNotes({ changelog: LOG, tag: 'v0.37.0', sha256: 'ab12', commit: 'c0ffee1', runUrl: 'https://example.test/run' });
  assert.match(n, /releases\/download\/v0\.37\.0\/Tapyor-Setup-0\.37\.0\.exe/);
  assert.match(n, /Выполнить в любом случае/);
  assert.match(n, /Главное — знакомство/);
  assert.match(n, /SHA-256 установщика: `ab12`/);
  assert.match(n, /\[журнал сборки\]\(https:\/\/example\.test\/run\)/);
});

test('нет раздела версии — ссылка на CHANGELOG вместо пустоты; плохой тег — ошибка', () => {
  const n = releaseNotes({ changelog: '', tag: 'v1.0.0' });
  assert.match(n, /CHANGELOG\.md/);
  assert.doesNotMatch(n, /SHA-256/);
  assert.throws(() => releaseNotes({ changelog: LOG, tag: 'latest' }));
});
