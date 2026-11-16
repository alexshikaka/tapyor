# WZ2a: шаг «Оформление» — больше не рисует своих образцов тем и оболочек.
# Шаг подсвечивает настоящую карточку оформления, а выбор темы в Тапёре отмечает задачу.
import os, asyncio, subprocess, json
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8801
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # В Тапёре есть настоящие оболочки и 8 тем, и они подсвечиваются.
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sLook',sel:'#sLook .card, #lookSlot .card'})")
        await pg.wait_for_timeout(300)
        ok(await E("document.querySelectorAll('#skinGrid .skin-c').length >= 4"), 'в «Оформлении» 4 настоящие оболочки')
        ok(await E("document.querySelectorAll('#teList .te-c').length >= 8"), 'и 8 настоящих тем')
        ok(await E("(function(){var e=document.querySelector('#sLook .card'); return !!(e && e.hasAttribute('data-wiz-hl'));})()"),
           'настоящая карточка оформления подсвечена')

        # Выбор темы в настоящем списке применяется тем же путём, что и раньше.
        await E("document.querySelector('#teList [data-theme=winter-l]').click()")
        await pg.wait_for_timeout(300)
        cls = await E("document.documentElement.className")
        ok('theme-custom' in cls and 'theme-light' in cls, 'светлая «Зима близко» сразу применена к Тапёру')
        ok(await E("localStorage.getItem('tapTheme')") == 'winter-l', 'выбор темы сохранён')
        # Оболочка тоже выбирается в настоящем списке.
        await E("document.querySelector('#skinGrid [data-skin=dos]').click()")
        await pg.wait_for_timeout(300)
        ok('skin-dos' in await E("document.documentElement.className") and
           'pixel-skin' in await E("document.documentElement.className"), 'оболочка VGA/DOS включается здесь же')
        # Вернуть как было.
        await E("document.querySelector('#skinGrid [data-skin=\"\"]').click()")
        await E("document.querySelector('#teList [data-theme=dark]').click()")
        await pg.wait_for_timeout(200)

        # Действий старых кнопок визарда (иконки/выбор) больше нет.
        ok(await E("typeof WIZ_ACTIONS === 'object' && !('lookIcons' in WIZ_ACTIONS) && !('lookPick' in WIZ_ACTIONS)"),
           'lookIcons/lookPick убраны — визард не рисует свои образцы')

        # Окно визарда: одна задача «Выбери тему» на настоящую карточку.
        errs2 = []
        pg2 = await b.new_page(viewport={'width': 380, 'height': 820})
        await pg2.add_init_script("""
          window.__wcalls = [];
          window.wizardApi = {
            cmd: function (p) { window.__wcalls.push(p); },
            close: function () { window.__wcalls.push({ op: 'close' }); },
            onEvent: function (fn) { window.__winit = fn; }
          };
        """)
        pg2.on('pageerror', lambda e: errs2.append(str(e)))
        await pg2.goto('http://127.0.0.1:%d/app2/wizard/index.html' % PORT)
        await pg2.wait_for_timeout(300)
        E2 = pg2.evaluate
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'look'})")
        await pg2.wait_for_timeout(150)
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Каким будет твой Тапёр?', 'шаг открылся вторым, сразу после развилки')
        calls = await E2("window.__wcalls")
        hl = [c for c in calls if c.get('op') == 'highlight']
        ok(bool(hl), 'шаг просит главное окно подсветить оформление')
        last = hl[-1]
        ok(last.get('tab') == 'settings' and last.get('pane') == 'sLook', 'открыты Настройки → «Оформление»')
        ok('#sLook .card' in (last.get('sel') or '') and '#lookSlot .card' in (last.get('sel') or ''),
           'подсвечена настоящая карточка оформления (она же во вкладке «Оформление»)')
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Выбери тему' in body, 'задача «Выбери тему»')
        ok(await E2("document.querySelectorAll('.wiz-look-grid, [data-skin], [data-theme]').length") == 0,
           'своих иконок тем и оболочек в визарде нет')
        await E2("window.__winit(%s)" % json.dumps({'type': 'hlAct', 'sel': last.get('sel'), 'kind': 'click'}, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        ok(await E2("document.querySelector('.wiz-task[data-task=theme]').classList.contains('done')"),
           'выбор в настоящем оформлении отмечает задачу')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
