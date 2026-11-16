import os
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# t33: «Модули → Пак стримера» (src/ui/26-packs.js): не установлен → установить → попробовать → ключ (ошибка и успех)
# → отвязка; строка лицензии в боте ведёт сюда.
# 11.11 (M7, Б9): «Отвязать» — только при известном ключе (keyMask); ручная лицензия — без кнопки; tpl1.… в поле «Ключ».
import asyncio
import subprocess
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8788', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

MOCK = r"""
(function(){
  var A = window.app = window.app || {};
  var MAN = { id: 'streamer-pack', name: 'Пак стримера', version: '0.3.0', minCore: '0.32.0', modules: [{ id: 'bot', name: 'Чат-бот Twitch' }, { id: 'overlay', name: 'Оверлей-плейлист' }] };
  var S = window.__pk = { installed: false, lic: { enabled: false, state: 'not-installed' }, calls: [], keyMask: '' };
  var subs = [];
  function st(){ return { installed: S.installed, manifest: S.installed ? MAN : null, running: false, license: S.lic, dev: false, prev: null, modules: {}, keyMask: S.keyMask }; }
  function push(){ subs.forEach(function (f){ f(st()); }); }
  A.modStatus = function(){ return Promise.resolve(st()); };
  A.onModStatus = function (f){ subs.push(f); };
  A.packCheck = function(){ S.calls.push('check'); return Promise.resolve({ ok: true, latest: { id: 'streamer-pack', version: '0.3.0', minCore: '0.32.0', size: 87000 }, installed: S.installed ? '0.3.0' : null, update: false, coreOk: true }); };
  A.packInstall = function(){ S.calls.push('install'); S.installed = true; S.lic = { enabled: false, state: 'none' }; push(); return Promise.resolve({ ok: true, version: '0.3.0' }); };
  A.licTrial = function(){ S.calls.push('trial'); S.lic = { enabled: true, state: 'trial', daysLeft: 30 }; push(); return Promise.resolve({ ok: true }); };
  A.licActivate = function (k){ S.calls.push('activate:' + k); if (k === 'TPR-BAD0-0000-0000') return Promise.resolve({ ok: false, error: 'такого ключа нет — проверь, нет ли опечатки' }); S.lic = { enabled: true, state: 'full' }; S.keyMask = String(k).slice(0, 9).replace(/-+$/, '') + '-••••'; push(); return Promise.resolve({ ok: true }); };
  A.licDeactivate = function(){ S.calls.push('deactivate'); S.lic = { enabled: false, state: 'none' }; S.keyMask = ''; push(); return Promise.resolve({ ok: true }); };
  A.licPaste = function (t){ S.calls.push('paste:' + String(t).slice(0, 5)); if (!/^tpl1\./.test(t)) return Promise.resolve({ ok: false, error: 'это не лицензия пака стримера' }); S.lic = { enabled: true, state: 'full' }; S.keyMask = ''; push(); return Promise.resolve({ ok: true }); };
  A.licRequest = function(){ return Promise.resolve({ ok: true, code: 'aaa,bbb,ccc', short: 'aaa-bbb-ccc' }); };
  A.packRemove = function(){ S.installed = false; S.lic = { enabled: false, state: 'not-installed' }; push(); return Promise.resolve({ ok: true }); };
})();
"""


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print('✓ ' + msg)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(script=MOCK)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8788/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate
        txt = lambda: E("(document.getElementById('packPanel')||{}).innerText||''")
        await E("openPackPane()")
        await pg.wait_for_timeout(500)
        ok(await E("!document.getElementById('sPack').hidden"), 'раздел «Пак стримера» открыт')
        ok('Установить' in await txt(), 'не установлен: кнопка «Установить», видна версия ' + ('0.3.0' if '0.3.0' in await txt() else '?'))
        await pg.click('[data-pk="install"]'); await pg.wait_for_timeout(400)
        t = await txt()
        ok('Попробовать 30 дней' in t and 'Ввести ключ' in t, 'установлен: «Попробовать 30 дней» и «Ввести ключ»')
        await pg.click('[data-pk="trial"]'); await pg.wait_for_timeout(400)
        ok('осталось 30' in await txt(), 'пробный период: «осталось 30 дней»')
        ok((await E("document.getElementById('packPill').textContent")) == 'пробный · 30 дн.', 'в меню — «пробный · 30 дн.»')
        await pg.click('[data-pk="key"]'); await pg.fill('#pkKey', 'TPR-BAD0-0000-0000'); await pg.click('[data-pk="activate"]'); await pg.wait_for_timeout(400)
        ok('такого ключа нет' in await txt(), 'неверный ключ — понятная ошибка')
        ok(await E("!!document.getElementById('pkKey')"), 'после ошибки поле ключа остаётся открытым')
        await pg.fill('#pkKey', 'TPR-AB12-CD34-EF56'); await pg.press('#pkKey', 'Enter'); await pg.wait_for_timeout(400)
        t = await txt()
        ok('Пак куплен' in t and 'Отвязать этот компьютер' in t, 'ключ принят: «Пак куплен», есть «Отвязать»')
        ok('TPR-AB12-••••' in t and 'CD34' not in t, 'M4: ключ показан маской, целиком — нет')
        ok((await E("document.getElementById('packPill').textContent")) == '', 'купленный пак — без плашки в меню')
        await pg.click('[data-pk="deactivate"]'); await pg.wait_for_timeout(400)
        ok('Попробовать 30 дней' in await txt(), 'отвязан — снова «Попробовать» и «Ключ»')
        # Б9: строка лицензии tpl1.… в обычном поле «Ключ» уходит в «Вставить лицензию», а не в активацию по ключу
        await pg.click('[data-pk="key"]'); await pg.fill('#pkKey', ' tpl1.eyJ2IjoxfQ.sig '); await pg.click('[data-pk="activate"]')
        # На медленном CI обновление состояния приходит позже 400 мс — ждём само событие, а не время (16.11, 0.38.1)
        try: await pg.wait_for_function("(() => { var c = window.__pk.calls, i = c.indexOf('paste:tpl1.'); return i >= 0 && c.length > i + 1; })()", timeout=5000)
        except Exception: pass
        await pg.wait_for_timeout(200)
        # Вставка лицензии — не последний вызов: интерфейс сразу обновляет состояние (check),
        # и это правильно. Проверяем, что paste был и сразу за ним прошло обновление состояния.
        calls = await E("window.__pk.calls")
        i = calls.index('paste:tpl1.') if 'paste:tpl1.' in calls else -1
        if not (i >= 0 and calls[i + 1:i + 2] == ['check']): print('Б9 вызовы:', calls[-8:])
        ok(i >= 0 and calls[i + 1:i + 2] == ['check'], 'Б9: tpl1.… из поля «Ключ» принята как лицензия, затем обновление состояния')
        t = await txt()
        ok('Пак куплен' in t and 'Отвязать этот компьютер' not in t and 'вставлена вручную' in t, 'M7: ручная лицензия — без «Отвязать», «место освобождает автор»')
        await E("window.__pk.lic = { enabled: false, state: 'none' }; window.__pk.keyMask = ''; packLoad(true)"); await pg.wait_for_timeout(400)
        await pg.click('[data-pk="manual"]'); await pg.click('[data-pk="req"]'); await pg.wait_for_timeout(300)
        ok(await E("!!document.querySelector('#packPanel input[readonly]') && document.querySelector('#packPanel input[readonly]').value === 'aaa,bbb,ccc'"), 'ручная активация: код компьютера показан')
        # строка лицензии в боте ведёт сюда
        ok('Ключ и пробный период' in await E("packLicStrip({ enabled:false, state:'trial-ended' })"), 'бот/оверлей: строка «пробный период закончился» с кнопкой')
        ok(await E("packLicStrip({ enabled:true, state:'full' })") == '', 'купленный пак — строки в боте нет')
        ok(not await E("document.body.innerText.includes('LICENSE-STUB') || document.body.innerText.includes('Скоро: ключи')"), 'заглушки «скоро» больше нет')
        print('ошибки:', errs)
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
