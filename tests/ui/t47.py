# t47 — «Исправить» кракозябры в своих плейлистах (G2):
# частичная починка: кнопка «занято» снимается, плашка честно говорит, что осталось
# и что относится к чужим плейлистам (их не трогаем). Ошибка и синхронный сбой тоже
# не должны оставлять кнопку в состоянии «занято».
import os
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio
import subprocess
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8794', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Подделка главного процесса: первый вызов проверки — 3 своих испорченных строки и
# 2 чужих (их чинить нельзя), ответ на «исправить» — частичный (2 починили, 1 не вышло,
# 2 чужих не трогали), после чего проверка возвращает 1 оставшуюся неисправимую строку.
MOCK = r"""
(function(){
  var M = window.__mj = {
    state: { ok: true, broken: 3, fixable: 3, unfixable: 0, foreign: 2, total: 5 },
    mode: '', calls: 0
  };
  window.app.mojibakeCheck = function(){ return Promise.resolve(M.state); };
  window.app.mojibakeFix = function(){
    M.calls++;
    if (M.mode === 'throw') throw new Error('тестовый сбой');
    if (M.mode === 'reject') return Promise.reject(new Error('тестовая ошибка'));
    return new Promise(function(r){
      setTimeout(function(){
        M.state = { ok: true, broken: 1, fixable: 0, unfixable: 1, foreign: 2, total: 3 };
        r({ ok: true, fixed: 2, failed: 1, skipped: 2 });
      }, 350);
    });
  };
})()
"""

bad = []


def check(name, cond):
    print(('  ✓ ' if cond else '  ✗ ') + name)
    if not cond:
        bad.append(name)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8794/app2/index.html')
        await pg.wait_for_timeout(800)
        E = pg.evaluate
        await pg.click('#tabs [data-tab=my]')
        await pg.wait_for_timeout(500)
        await E(MOCK)
        await E("mojiCheck()")
        await pg.wait_for_timeout(150)

        mtext = await E("(document.querySelector('#mySide .moji') || {}).innerText || ''")
        check('плашка: сколько исправим и что чужие не трогаем',
              'исправлю 3' in mtext and '2 — не плейлисты Тапёра' in mtext)
        check('кнопка «Исправить» доступна',
              await E("!!document.querySelector('#mySide [data-moji]') && !document.querySelector('#mySide [data-moji]').disabled"))

        # ===== частичная починка: 2 исправлено, 1 не вышло, 2 чужих пропущено =====
        await pg.click('#mySide [data-moji]')
        await pg.wait_for_timeout(60)
        check('во время починки кнопка занята',
              await E("MOJI.busy === true && !!document.querySelector('#mySide [data-moji]') && document.querySelector('#mySide [data-moji]').disabled === true"))
        await pg.wait_for_timeout(900)
        check('после частичной починки «занято» снято', await E("MOJI.busy === false"))
        check('остались только неисправимые — плашки больше нет (хотфикс 0.36.3: нечего нажать)',
              await E("!document.querySelector('#mySide .moji')"))
        toast = await E("document.getElementById('toast').textContent")
        check('итог в подсказке: починено / не вышло / чужое',
              'исправлено 2' in toast and 'не вышло 1' in toast and 'чужих не трогаю 2' in toast)
        check('кнопка действительно вызвала mojibakeFix', await E("window.__mj.calls") == 1)

        # ===== ошибка ответа: «занято» снимается =====
        await E("window.__mj.state = { ok: true, broken: 3, fixable: 3, unfixable: 0, foreign: 2, total: 5 }; window.__mj.mode = 'reject'; mojiCheck()")
        await pg.wait_for_timeout(150)
        await pg.click('#mySide [data-moji]')
        await pg.wait_for_timeout(400)
        check('ошибка ответа: «занято» снято', await E("MOJI.busy === false"))
        check('ошибка ответа: понятная подсказка',
              'Не исправил: тестовая ошибка' in await E("document.getElementById('toast').textContent"))
        check('ошибка ответа: кнопка снова доступна',
              await E("!!document.querySelector('#mySide [data-moji]') && !document.querySelector('#mySide [data-moji]').disabled"))

        # ===== синхронное исключение: именно оно раньше оставляло кнопку «занятой» =====
        await E("window.__mj.mode = 'throw'")
        await pg.click('#mySide [data-moji]')
        await pg.wait_for_timeout(400)
        check('синхронный сбой: «занято» снято', await E("MOJI.busy === false"))
        check('синхронный сбой: подсказка об ошибке',
              'Не исправил: тестовый сбой' in await E("document.getElementById('toast').textContent"))

        print('ошибки:', errs)
        await b.close()
    if bad:
        raise SystemExit('провалено: ' + ', '.join(bad))

try:
    asyncio.run(main())
finally:
    srv.terminate()
