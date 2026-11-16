# WZ3: справка «Живая очередь» в главном окне — первый показ при переключении,
# повторно не появляется, «?» открывает, «Вернуть классический» переключает режим,
# пункт про заказы — только у стримера.
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8811', '--bind', '127.0.0.1'], cwd='.',
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
        await pg.goto('http://127.0.0.1:8811/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # Слушатель: «?» рядом с переключателем режима очереди
        await E("applyStreamer(false)")
        await E("window.__wcmd({op:'set',key:'queueMode',value:'classic'})")
        await pg.wait_for_timeout(250)
        ok(await E("!!document.querySelector('#qMode .qm-help')"), 'у переключателя режима есть «?»')
        ok(await E("getComputedStyle(document.querySelector('#qMode .qm-help')).fontFamily === getComputedStyle(document.body).fontFamily"), '«?» наследует шрифт оболочки')
        ok(await E("document.getElementById('liveHelp') === null || document.getElementById('liveHelp').hidden"), 'до первого переключения справки нет')

        # Первое переключение на «Живую очередь» — справка появляется сама
        await pg.click('#qModeTg')
        await pg.wait_for_timeout(400)
        ok(await E("!!document.getElementById('liveHelp') && document.getElementById('liveHelp').hidden === false"), 'первое переключение показывает справку')
        ok(await E("document.querySelector('#liveHelp .lh-title').textContent") == 'Классический плейлист и живая очередь', 'заголовок справки: два режима')
        ok(await E("document.querySelectorAll('#liveHelp .lh-row[data-n]').length") == 4, 'слушателю — четыре пункта')
        ok(await E("!document.querySelector('#liveHelp .lh-streamer')"), 'пункта про заказы у слушателя нет')
        ok(await E("window.__store.liveHelpSeen === true"), 'показ отмечен в настройках')
        ok(await E("getComputedStyle(document.querySelector('#liveHelp .lh-dlg')).backgroundColor") != 'rgba(0, 0, 0, 0)', 'окно справки на фоне темы')

        # «Понятно» закрывает
        await pg.click('#liveHelp [data-lh=ok]')
        await pg.wait_for_timeout(150)
        ok(await E("document.getElementById('liveHelp').hidden === true"), '«Понятно» закрывает справку')

        # Второе переключение — справка больше не лезет
        await pg.click('[data-qm=classic]')
        await pg.wait_for_timeout(150)
        await pg.click('[data-qm=live]')
        await pg.wait_for_timeout(400)
        ok(await E("document.getElementById('liveHelp').hidden === true"), 'второе переключение справку не показывает')

        # «?» открывает её в любой момент
        await pg.click('#qMode .qm-help')
        await pg.wait_for_timeout(200)
        ok(await E("document.getElementById('liveHelp').hidden === false"), '«?» открывает справку')
        ok(await E("document.querySelectorAll('#liveHelp .lh-row[data-n]').length") == 4, 'по «?» те же четыре пункта')

        # Окно и строки цветут переменными темы (светлая тема и оболочки красят их сами)
        await E("document.documentElement.style.setProperty('--bg2','rgb(1, 2, 3)')")
        await pg.wait_for_timeout(80)
        ok(await E("getComputedStyle(document.querySelector('#liveHelp .lh-dlg')).backgroundColor") == 'rgb(1, 2, 3)', 'фон справки — из переменной темы')
        await E("document.documentElement.style.removeProperty('--bg2')")

        # «Вернуть классический» переключает режим и закрывает
        await pg.click('#liveHelp [data-lh=classic]')
        await pg.wait_for_timeout(300)
        ok(await E("document.getElementById('liveHelp').hidden === true"), '«Вернуть классический» закрывает справку')
        ok(await E("document.getElementById('qModeTg').classList.contains('on') === false"), 'режим вернулся в классический')
        ok(await E("window.__store.queueMode") == 'classic', 'классический режим сохранён')

        # Стримеру — пятый пункт про заказы
        await E("applyStreamer(true)")
        await pg.wait_for_timeout(120)
        await pg.click('#qMode .qm-help')
        await pg.wait_for_timeout(200)
        ok(await E("document.querySelectorAll('#liveHelp .lh-row[data-n]').length") == 4, 'у стримера те же четыре общих пункта')
        ok(await E("!!document.querySelector('#liveHelp .lh-streamer')"), 'у стримера есть пункт про заказы')
        txt = await E("document.querySelector('#liveHelp .lh-streamer').textContent")
        ok('заказы зрителей' in txt.lower(), 'пункт 5 — про заказы зрителей: ' + txt.strip()[:80])
        await pg.click('#liveHelp [data-lh=ok]')
        await pg.wait_for_timeout(120)

        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
