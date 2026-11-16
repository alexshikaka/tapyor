import os
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# Короткий smoke: приложение открылось, вкладки настроек живы, старая простыня работает,
# настройка сохраняется, очередь не пустая страница. Полный набор — t9–t32.
import asyncio
import subprocess
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8788', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None),
                                    args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8788/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # 1. Страница вообще отрисовалась.
        ok(await E("document.body.innerText.trim().length > 20"), 'пустая страница')
        ok(await E("!!document.getElementById('tabs')"), 'нет верхних вкладок')

        # 2. Настройки: вкладки, ровно один раздел, переключение.
        await pg.click('#tabs [data-tab=settings]')
        await pg.wait_for_timeout(400)
        n = await E("document.querySelectorAll('.set-side [data-go]').length")
        ok(n >= 5, 'в настройках меньше 5 разделов: %s' % n)
        ok(await E("!!document.getElementById('sAbout')"), 'нет раздела «О программе»')
        ok(await E("document.getElementById('sAbout').hidden === false"), '«О программе» не открылись по умолчанию')
        ok(await E("document.getElementById('sLook').hidden === true"), 'в tabs виден лишний раздел')
        await pg.click('.set-side [data-go=sLook]')
        await pg.wait_for_timeout(250)
        ok(await E("document.getElementById('sLook').hidden === false"), 'не открылся раздел «Оформление»')
        ok(await E("document.getElementById('sAbout').hidden === true"), 'старый раздел не скрылся')
        ok(await E("document.querySelector('.set-side [data-go=sLook]').classList.contains('on')"), 'нет подсветки раздела')
        # 14.11: настройки каждый раз открываются на «О программе»
        await pg.click('#tabs [data-tab=search]')
        await pg.wait_for_timeout(150)
        await pg.click('#tabs [data-tab=settings]')
        await pg.wait_for_timeout(250)
        ok(await E("document.getElementById('sAbout').hidden === false && document.getElementById('sLook').hidden === true"), 'повторно настройки открылись не на «О программе»')

        # 3. Старая простыня: все разделы видны, потом назад в tabs.
        await E("window.applySettingsLayout('sheet')")
        await pg.wait_for_timeout(200)
        ok(await E("document.getElementById('viewSettings').classList.contains('set-sheet')"), 'не включилась простыня')
        ok(await E("document.getElementById('sAcc').hidden === false && document.getElementById('sLook').hidden === false"), 'в простыне разделы скрыты')
        await E("window.applySettingsLayout('tabs')")
        await pg.wait_for_timeout(200)
        ok(await E("document.getElementById('viewSettings').classList.contains('set-tabs')"), 'не вернулись в tabs')

        # 4. Настройка сохраняется через мост (в реальном приложении — settings-store).
        await E("window.app.setSetting('smokeKey', 'ok')")
        got = await E("window.app.getSetting('smokeKey')")
        ok(got == 'ok', 'настройка не сохранилась: %r' % got)

        # 5. Очередь/плеер не пустой экран.
        await pg.click('#tabs [data-tab=search]')
        await pg.wait_for_timeout(200)
        ok(await E("!!document.getElementById('queue')"), 'нет блока очереди')
        ok(await E("!!document.getElementById('aud')"), 'нет аудиоплеера')

        ok(not errs, 'ошибки страницы: %s' % errs)
        print('UI smoke: OK (разделов: %d, ошибок: 0)' % n)
        await b.close()


try:
    asyncio.run(main())
finally:
    srv.terminate()
