// Настройки: память, отложенная запись, запасная копия, битый файл не стирает плейлисты.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const st = require('../../src/settings-store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapyor-set-'));
const F = path.join(dir, 'settings.json');
const logs = []; const log = (m) => logs.push(m);
const big = { savedLists: Array.from({ length: 50 }, (_, i) => ({ src: 'tap', title: 'Плейлист ' + i, tracks: [{ id: i }] })) };
(async () => {
  // 1. обычный файл: читается один раз, правка уходит на диск пачкой
  fs.writeFileSync(F, JSON.stringify(big));
  st.setup({ file: F, log });
  assert.strictEqual(st.get('savedLists').length, 50);
  st.set('vol', 70); st.set('theme', 'mono');
  assert.strictEqual(JSON.parse(fs.readFileSync(F, 'utf8')).vol, undefined, 'запись не сразу');
  await new Promise((r) => setTimeout(r, 600));
  let disk = JSON.parse(fs.readFileSync(F, 'utf8'));
  assert.strictEqual(disk.vol, 70); assert.strictEqual(disk.theme, 'mono'); assert.strictEqual(disk.savedLists.length, 50);
  assert.ok(fs.existsSync(F + '.bak'), 'есть запасная копия'); assert.ok(!fs.existsSync(F + '.tmp'), 'нет .tmp');
  // 2. файл поменяли снаружи — перечитываем (R2: statSync не чаще раза в секунду)
  disk.extra = 1; fs.writeFileSync(F, JSON.stringify(disk)); const t = new Date(Date.now() + 5000); fs.utimesSync(F, t, t);
  await new Promise((r) => setTimeout(r, 1100));
  assert.strictEqual(st.get('extra'), 1, 'внешняя правка видна');
  // 3. файл обрезан посреди записи — плейлисты не теряются, поднимаем .bak
  st.flush(); fs.writeFileSync(F, fs.readFileSync(F, 'utf8').slice(0, 200));
  st.setup({ file: F, log });
  assert.strictEqual(st.get('savedLists').length, 50, 'восстановлено из .bak');
  st.set('vol', 55); st.flush();
  disk = JSON.parse(fs.readFileSync(F, 'utf8'));
  assert.strictEqual(disk.savedLists.length, 50, 'после записи плейлисты на месте'); assert.strictEqual(disk.vol, 55);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('settings.json.broken-')), 'битый файл отложен');
  // 4. основного файла нет (сбой между записями) — тоже из .bak
  fs.unlinkSync(F); st.setup({ file: F, log });
  assert.strictEqual(st.get('savedLists').length, 50, 'без основного — из .bak');
  // 5. первый запуск: нет ничего — пусто, без ошибок
  const F2 = path.join(dir, 'new', 'settings.json'); st.setup({ file: F2, log });
  assert.deepStrictEqual(st.all(), {}); st.set('a', 1); st.flush(); assert.strictEqual(JSON.parse(fs.readFileSync(F2, 'utf8')).a, 1);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('settings: ok');
})().catch((e) => { console.error('settings: ' + e.message); process.exit(1); });
