# HK1a (16.11.2026): горячая клавиша «Показать Тапёр поверх окон» есть в настройках, по умолчанию Ctrl+Alt+T,
# её можно переназначить, «Сбросить» возвращает Ctrl+Alt+T. Само поднятие окна делает главный процесс
# (showMainWindow в src/main.js) — здесь проверяется только окно настроек.
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8780
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

ROWS = """[].map.call(document.querySelectorAll('#hkList .srow'), function(r){
  return [r.querySelector('.st').textContent.trim(), r.querySelector('.kcap').textContent.trim()]; })"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script("window.__hkSaved = []; (function(){ var t = setInterval(function(){ if (!window.app) return; clearInterval(t);"
                                 " var o = window.app.setSetting; window.app.setSetting = function(k, v){ if (k === 'hotkeys') window.__hkSaved.push(JSON.parse(JSON.stringify(v))); return o ? o.apply(this, arguments) : Promise.resolve(null); }; }, 5); })();")
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
        await pg.wait_for_timeout(900)
        E = pg.evaluate
        rows = await E(ROWS)
        show = [r for r in rows if r[0] == 'Показать Тапёр поверх окон']
        ok(len(show) == 1, 'в горячих клавишах есть «Показать Тапёр поверх окон»: %r' % [r[0] for r in rows])
        ok(show[0][1] == 'Ctrl + Alt + T', 'по умолчанию Ctrl + Alt + T: %r' % show[0][1])
        # переназначить: нажать на кнопку строки и сочетание Ctrl+Alt+Home
        await E("""(function(){ var rs = document.querySelectorAll('#hkList .srow');
          for (var i = 0; i < rs.length; i++) if (rs[i].querySelector('.st').textContent.trim() === 'Показать Тапёр поверх окон') rs[i].querySelector('.kcap').click(); })()""")
        await pg.wait_for_timeout(100)
        await pg.keyboard.press('Control+Alt+Home')
        await pg.wait_for_timeout(300)
        rows = await E(ROWS)
        show = [r for r in rows if r[0] == 'Показать Тапёр поверх окон']
        ok(show[0][1] == 'Ctrl + Alt + Home', 'переназначено на Ctrl + Alt + Home: %r' % show[0][1])
        saved = await E("window.__hkSaved.length ? window.__hkSaved[window.__hkSaved.length - 1] : null")
        ok(saved and saved.get('show') == 'Ctrl+Alt+Home', 'сохраняется в настройке hotkeys.show: %r' % saved)
        await E("document.getElementById('hkReset').click()")
        await pg.wait_for_timeout(300)
        saved = await E("window.__hkSaved[window.__hkSaved.length - 1]")
        ok(saved.get('show') == 'Ctrl+Alt+T', '«Сбросить» возвращает Ctrl+Alt+T')
        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
