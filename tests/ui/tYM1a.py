# YM1a (15.11.2026): вход в Яндекс через браузер. Окно с кодом не открывает браузер сразу —
# кнопка «Перейти в браузер (10)» считает секунды и открывает страницу сама или по нажатию.
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8775
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

START = """(function(){
  window.__opened = [];
  window.app.openExternal = function(u){ window.__opened.push(u); return Promise.resolve(true); };
  window.app.ymLoginBrowserStart = function(){ return Promise.resolve({ user_code: 'ABC1234', verification_url: 'https://ya.ru/device', open_url: 'https://ya.ru/device' }); };
  window.app.ymLoginBrowserWait = function(){ return new Promise(function(){}); };
  window.app.ymLoginBrowserCancel = function(){};
  return true; })()"""

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

        # Нажатие кнопки: браузер открывается сразу
        await E(START)
        await E("(browserLogin(), 1)")
        await pg.wait_for_timeout(300)
        ok(await E("!document.getElementById('loginModal').hidden"), 'окно с кодом открыто')
        ok(await E("document.getElementById('lmCode').textContent") == 'ABC1234', 'код виден')
        ok(await E("window.__opened.length") == 0, 'браузер сразу не открывается')
        t = await E("document.getElementById('lmOpen').textContent")
        ok(t == 'Перейти в браузер (10)', 'кнопка с отсчётом: ' + t)
        await pg.wait_for_timeout(1200)
        t = await E("document.getElementById('lmOpen').textContent")
        ok(t == 'Перейти в браузер (9)', 'отсчёт идёт: ' + t)
        await E("document.getElementById('lmOpen').click()")
        await pg.wait_for_timeout(100)
        ok(await E("window.__opened") == ['https://ya.ru/device'], 'по нажатию открыта страница Яндекса')
        ok(await E("document.getElementById('lmOpen').textContent") == 'Открыть страницу ещё раз', 'кнопка стала «Открыть ещё раз»')
        await pg.wait_for_timeout(1500)
        ok(await E("window.__opened.length") == 1, 'после нажатия отсчёт больше не открывает браузер')
        await E("document.getElementById('lmCancel').click()")

        # Без нажатия: через 10 с браузер открывается сам; «Отмена» до конца отсчёта — не открывается
        await E(START)
        await E("(browserLogin(), 1)")
        await pg.wait_for_timeout(300)
        await E("document.getElementById('lmCancel').click()")
        await pg.wait_for_timeout(10500)
        ok(await E("window.__opened.length") == 0, '«Отмена» останавливает отсчёт')
        await E(START)
        await E("(browserLogin(), 1)")
        await pg.wait_for_timeout(10600)
        ok(await E("window.__opened") == ['https://ya.ru/device'], 'через 10 с браузер открылся сам')
        ok('открыта' in await E("document.getElementById('lmText').textContent"), 'текст говорит, что страница открыта')

        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
