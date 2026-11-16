# WZ2d: шаг «Поиск» — главное окно само впечатывает «Кино — Группа крови», выдача появляется,
# «трек заиграл» приходит событием played и только тогда в визарде появляется «Дальше».
import os, asyncio, subprocess, json
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8800
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None),
                                    args=['--autoplay-policy=no-user-gesture-required'])
        errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        await E("window.__wcmd({op:'do',name:'searchWatch',args:{on:true}})")
        await E("window.__wcmd({op:'do',name:'searchRun'})")
        await pg.wait_for_timeout(1600)
        val = await E("document.getElementById('search').value")
        ok(val == 'Кино — Группа крови', 'главное окно само впечатало «Кино — Группа крови»')
        rows = await E("document.querySelectorAll('#results .row').length")
        ok(rows > 0, 'выдача поиска нарисована (%d строк)' % rows)
        ev = await E("(window.__wevents||[]).filter(function(e){return e.type==='search'}).slice(-1)[0]")
        ok(bool(ev) and ev.get('state') == 'ready', 'шаг получает состояние «выдача готова»')

        # «Трек заиграл»: общий звук окна — событие шага
        before = await E("(window.__wevents||[]).filter(function(e){return e.type==='played'}).length")
        await E("document.getElementById('aud').dispatchEvent(new Event('playing'))")
        await pg.wait_for_timeout(200)
        after = await E("(window.__wevents||[]).filter(function(e){return e.type==='played'}).length")
        ok(after == before + 1, 'звук заиграл → шаг получает событие played')

        # Заглушить слежение — новые «playing» больше не считаются
        await E("window.__wcmd({op:'do',name:'searchWatch',args:{on:false}})")
        n1 = await E("(window.__wevents||[]).filter(function(e){return e.type==='played'}).length")
        await E("document.getElementById('aud').dispatchEvent(new Event('playing'))")
        await pg.wait_for_timeout(150)
        n2 = await E("(window.__wevents||[]).filter(function(e){return e.type==='played'}).length")
        ok(n2 == n1, 'после ухода с шага слежение выключено')

        # Окно визарда: карточка, «Дальше» только после прослушивания
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
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'search'})")
        await pg2.wait_for_timeout(120)
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'do' and c.get('name') == 'searchRun' for c in calls), 'шаг просит главное окно начать поиск')
        ok(any(c.get('op') == 'do' and c.get('name') == 'searchWatch' and c.get('args', {}).get('on') is True for c in calls),
           'и включает слежение за воспроизведением')
        await E2("window.__winit(%s)" % json.dumps({'type': 'search', 'state': 'ready', 'count': 5}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Выбери песню и нажми ▶' in body, 'карточка «Выбери песню и нажми ▶»')
        ok('дальше — само, после ▶' not in body, 'подсказки «дальше — само» больше нет (16.11)')
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'highlight' and c.get('sel') == '#results' for c in calls), 'подсвечена выдача поиска')
        ok(await E2("!!document.querySelector('.wiz-sh-next')"), '«Дальше» доступна сразу, песню ставить не обязательно (16.11)')

        await E2("window.__winit(%s)" % json.dumps({'type': 'played', 'title': 'Кино — Кукушка'}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Играет: Кино — Кукушка' in body, 'после ▶ карточка показывает, что играет')
        ok(await E2("!!document.querySelector('.wiz-sh-next')"), 'и появляется «Дальше»')
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'clear' for c in calls), 'подсветка снята после прослушивания')
        await pg2.click('[data-act="next"]')
        await pg2.wait_for_timeout(150)
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Любой список — в плейлист', '«Дальше» ведёт к «Плейлистам»')

        # Ветка «нечего слушать целиком»: вместо ▶ — вход в Яндекс и назад к «Входам»
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'search'})")
        await pg2.wait_for_timeout(120)
        await E2("window.__winit(%s)" % json.dumps({'type': 'search', 'state': 'no-full', 'count': 5}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Чтобы слушать, войди в Яндекс' in body, 'ветка «ничего не играет целиком» — как в плане')
        await pg2.click('[data-act="goLogins"]')
        await pg2.wait_for_timeout(100)
        calls = await E2("window.__wcalls")
        last = [c for c in calls if c.get('name') == 'wizGoStep']
        ok(bool(last) and last[-1].get('args', {}).get('step') == 'logins', 'кнопка возвращает к шагу «Входы»')

        # «Поиск молчит» — «Дальше» разрешено
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'search'})")
        await pg2.wait_for_timeout(120)
        await E2("window.__winit(%s)" % json.dumps({'type': 'search', 'state': 'empty', 'count': 0}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        ok(await E2("!!document.querySelector('.wiz-sh-next')"), 'если поиск ничего не нашёл — «Дальше» доступна')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
