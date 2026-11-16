# WZ6a (15.11.2026): визард-подсказчик. Подсветка открывает раздел Настроек, главное окно
# сообщает визарду, что подсвеченную кнопку нажали или поле заполнили (пароли — без значения),
# и «← Назад» в окне визарда.
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8781
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
        await E("window.__wopened && window.__wopened()")

        # Подсветка с разделом: открыт именно «Донаты», а не «О программе»
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sStream',sel:'#stPrice'})")
        await pg.wait_for_timeout(700)
        ok(await E("curTab") == 'settings', 'открыты Настройки')
        ok(await E("!document.getElementById('sStream').hidden || !document.getElementById('viewSettings').classList.contains('set-tabs')"), 'и раздел «Донаты»')
        ok(await E("document.getElementById('stPrice').classList.contains('wiz-hl')"), 'поле цены подсвечено')

        # Развилка поверх Тапёра: затемнение на всё окно ловит мышь, после ответа снимается
        await E("window.__wcmd({op:'block',on:true})")
        await pg.wait_for_timeout(300)
        top = await E("document.elementFromPoint(700, 450).id")
        ok(top == 'wizBlock', 'пока развилка — Тапёр закрыт затемнением')
        await E("window.__wcmd({op:'block',on:false})")
        await pg.wait_for_timeout(400)
        ok(await E("!document.getElementById('wizBlock')"), 'после ответа затемнение снято')

        # Ввод в подсвеченное поле — событие визарду
        await E("window.__wevents = []")
        await pg.fill('#stPrice', '150')
        await pg.wait_for_timeout(600)
        ev = await E("(window.__wevents||[]).filter(function(e){return e.type==='hlAct'})")
        ok(any(e.get('sel') == '#stPrice' and e.get('filled') is True and e.get('value') == '150' for e in ev), 'визард узнаёт, что поле заполнено')

        # Пароль: только «заполнено», без значения
        await E("var i=document.createElement('input');i.type='password';i.id='wizPw';document.getElementById('sStream').appendChild(i);true")
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sStream',sel:'#wizPw'})")
        await pg.wait_for_timeout(400)
        await E("window.__wevents = []")
        await pg.fill('#wizPw', 'секрет123')
        await pg.wait_for_timeout(600)
        ev = await E("(window.__wevents||[]).filter(function(e){return e.type==='hlAct'})")
        ok(ev and all('value' not in e for e in ev) and any(e.get('filled') for e in ev), 'пароль визарду не уходит — только «заполнено»')

        # Нажатие подсвеченной кнопки
        await E("var bt=document.createElement('button');bt.id='wizBtn';bt.textContent='x';document.getElementById('sStream').appendChild(bt);true")
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sStream',sel:'#wizBtn'})")
        await pg.wait_for_timeout(400)
        await E("window.__wevents = []")
        await pg.click('#wizBtn')
        await pg.wait_for_timeout(150)
        ev = await E("(window.__wevents||[]).filter(function(e){return e.type==='hlAct'})")
        ok(any(e.get('sel') == '#wizBtn' and e.get('kind') == 'click' for e in ev), 'нажатие подсвеченной кнопки — событие визарду')

        # Кнопки нет — визард узнаёт об этом
        await E("window.__wevents = []")
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sStream',sel:'#netTakoy'})")
        await pg.wait_for_timeout(1800)
        ok(await E("(window.__wevents||[]).some(function(e){return e.type==='hlMissing' && e.sel==='#netTakoy'})"), 'нет кнопки — событие hlMissing')
        await E("window.__wcmd({op:'clear'})")

        # Окно визарда: «Назад»
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
        await E2("window.__winit({type:'init',from:'debug'})")
        await pg2.wait_for_timeout(120)
        ok(await E2("document.getElementById('wizFoot').hidden"), 'на развилке подвала нет')
        # Развилка (15.11): шире колонки — варианты рядом; ответ просит главный процесс увезти окно вбок
        await pg2.set_viewport_size({'width': 620, 'height': 460})
        await pg2.wait_for_timeout(80)
        r = await E2("[].map.call(document.querySelectorAll('.wiz-fork'), function(b){return b.getBoundingClientRect().top})")
        ok(len(r) == 2 and abs(r[0] - r[1]) < 2, 'в окне по центру варианты стоят рядом')
        await pg2.click('[data-route=streamer]')
        await pg2.wait_for_timeout(150)
        await pg2.set_viewport_size({'width': 380, 'height': 820})
        ok(any(c.get('op') == 'dock' for c in await E2("window.__wcalls")), 'ответ на развилке — команда dock')
        ok(await E2("document.getElementById('wizBack').hidden === false"), 'после развилки есть «Назад»')
        t1 = await E2("document.getElementById('wizTitle').textContent")
        await pg2.click('#wizSkip')
        await pg2.wait_for_timeout(150)
        t2 = await E2("document.getElementById('wizTitle').textContent")
        ok(t1 != t2, 'шаг вперёд')
        await pg2.click('#wizBack')
        await pg2.wait_for_timeout(150)
        ok(await E2("document.getElementById('wizTitle').textContent") == t1, '«Назад» возвращает прошлый шаг')
        await pg2.click('#wizBack')
        await pg2.wait_for_timeout(150)
        ok(await E2("document.querySelectorAll('.wiz-fork').length") == 2, 'и до развилки')

        # «Готов к эфиру» (16.11): обычный подвал — «Назад» и «Дальше», без «Пропустить»
        await E2("window.__winit({type:'init',from:'debug',route:'streamer',step:'streamer-final'})")
        await pg2.wait_for_timeout(150)
        ok(await E2("document.getElementById('wizBack').hidden === false && document.getElementById('wizNext').hidden === false && document.getElementById('wizSkip').hidden === true"), '«Готов к эфиру» — «Назад» и «Дальше»')
        # Шаг 13 «Взаимодействие со зрителями» (16.11): «Назад» и «Дальше»
        await E2("window.__winit({type:'init',from:'debug',route:'streamer',step:'viewers'})")
        await pg2.wait_for_timeout(150)
        ok(await E2("document.getElementById('wizBack').hidden === false && document.getElementById('wizNext').hidden === false"), 'на шаге 13 — «Назад» и «Дальше»')

        # Один шаг из Настроек: назад некуда
        await E2("window.__winit({type:'init',from:'settings',step:'donations'})")
        await pg2.wait_for_timeout(150)
        ok(await E2("document.getElementById('wizBack').hidden === true"), 'одиночный шаг из Настроек — без «Назад»')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
