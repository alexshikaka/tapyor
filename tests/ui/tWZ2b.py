# WZ2b: шаг «Входы» — лампочки из быстрой проверки; вход и переключатели площадок теперь
# живут только в Настройках → «Аккаунты», визард их подсвечивает. Яндекс уже вошёл —
# задача отмечена сразу; обе задачи «по желанию».
import os, asyncio, subprocess, json
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8802
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

        # Поддельная быстрая проверка: Яндекс работает, YouTube и SoundCloud/Audius — нет.
        await E("""
          (function () {
            window.QC.items = {
              'ym.svc': { id: 'ym.svc', state: 'ok', text: 'доступен' },
              'yt.svc': { id: 'yt.svc', state: 'bad', text: 'не отвечает' },
              'sc':     { id: 'sc', state: 'bad', text: 'не отвечают' }
            };
            window.app.onQcItem = function (fn) { window.__qcb = fn; };
            window.app.qcRun = function () { return Promise.resolve({ at: Date.now(), items: window.QC.items }); };
            return true;
          })()
        """)
        await E("window.__wcmd({op:'do',name:'loginsCheck'})")
        await pg.wait_for_timeout(500)
        ev = await E("(window.__wevents||[]).filter(function(e){return e.type==='logins' && e.items}).slice(-1)[0]")
        ok(bool(ev), 'шаг получает лампочки площадок из быстрой проверки')
        ok(ev['items']['ymSvc']['state'] == 'ok' and ev['items']['ytSvc']['state'] == 'bad', 'состояния Яндекс/YouTube доехали как есть')
        ok(ev['items']['sc']['state'] == 'bad', 'общая строка SoundCloud/Audius доехала')
        acc = await E("(window.__wevents||[]).filter(function(e){return e.type==='logins' && e.accounts}).slice(-1)[0]")
        ok(bool(acc) and acc['accounts']['ym']['loggedIn'] is True, 'состояние входа Яндекса доехало')
        # Шаг открыли заново: состояние входа приходит ещё раз, даже если не изменилось.
        n1 = await E("(window.__wevents||[]).filter(function(e){return e.type==='logins' && e.accounts}).length")
        await E("window.__wcmd({op:'do',name:'loginsCheck'})")
        await pg.wait_for_timeout(400)
        n2 = await E("(window.__wevents||[]).filter(function(e){return e.type==='logins' && e.accounts}).length")
        ok(n2 > n1, 'при повторном входе на шаг состояние входа приходит заново')

        # Живые лампочки: пункт проверки пришёл по ходу — сообщаем сразу
        await E("window.QC.items['yt.svc'] = { id:'yt.svc', state:'ok', text:'доступен' }; window.__qcb(window.QC.items['yt.svc'])")
        await pg.wait_for_timeout(120)
        ev2 = await E("(window.__wevents||[]).filter(function(e){return e.type==='logins' && e.items}).slice(-1)[0]")
        ok(ev2['items']['ytSvc']['state'] == 'ok', 'пришедший пункт проверки сразу меняет лампочку')

        # Настоящие кнопки и переключатели в «Аккаунтах» — их и подсвечивает визард.
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sAcc',sel:'#setYmBtn'})")
        await pg.wait_for_timeout(300)
        ok(await E("!!document.querySelector('#setYmBtn') && !!document.querySelector('#setYtLogin')"),
           'в «Аккаунтах» есть настоящие кнопки «Войти» Яндекс и YouTube')
        ok(await E("!!document.querySelector('[data-set-tg=ymEnabled]') && !!document.querySelector('[data-set-tg=ytEnabled]')"),
           'рядом — переключатели «пользоваться площадкой»')
        ok(await E("document.querySelector('#setYmBtn').hasAttribute('data-wiz-hl')"), 'кнопка входа Яндекса подсвечена')
        ok(await E("typeof WIZ_ACTIONS === 'object' && !('loginsYm' in WIZ_ACTIONS) && !('loginsYt' in WIZ_ACTIONS) && !('loginsUse' in WIZ_ACTIONS)"),
           'своих действий входа/«Не пользуюсь» у визарда больше нет')

        # Окно визарда: две задачи на настоящие кнопки, лампочки и подписи.
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
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'logins'})")
        await pg2.wait_for_timeout(120)
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Откуда будет музыка', 'шаг «Входы» открылся')
        calls = await E2("window.__wcalls")
        hl = [c for c in calls if c.get('op') == 'highlight']
        ok(bool(hl) and hl[-1].get('pane') == 'sAcc' and hl[-1].get('sel') == '#setYmBtn',
           'подсвечена настоящая кнопка входа Яндекса в «Аккаунтах»')
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Войти в Яндекс Музыку' in body and 'Войти в YouTube' in body, 'обе задачи — про настоящие кнопки входа')
        ok(body.count('по желанию') >= 2 and 'Можно без входа' in body, 'обе задачи «по желанию»: можно без входа')
        ok(await E2("document.querySelectorAll('[data-act]').length") == 0, 'своих кнопок «Войти»/«Не пользуюсь» нет')
        ok(await E2("document.querySelectorAll('.wiz-task').length") == 2, 'ровно две задачи')
        ok(await E2("document.querySelectorAll('.wiz-task.opt').length") == 2, 'обе помечены «по желанию»')

        payload = {
            'type': 'logins',
            'items': {'ymSvc': {'state': 'ok', 'text': 'доступен'}, 'ytSvc': {'state': 'bad', 'text': 'не отвечает'}, 'sc': {'state': 'bad', 'text': 'не отвечают'}},
            'accounts': {'ym': {'loggedIn': False, 'name': ''}, 'yt': {'name': ''}},
            'enabled': {'ym': True, 'yt': True}
        }
        await E2("window.__winit(%s)" % json.dumps(payload, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        ok(await E2("document.querySelectorAll('.wiz-lg-lamp').length") == 4, 'четыре лампочки площадок')
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Сейчас работает только Яндекс Музыка' in body and 'VPN' in body, 'состояние «доступен только Яндекс» и подсказка про VPN')
        ok(await E2("document.querySelector('.wiz-task[data-task=ym]').classList.contains('done')") is False,
           'входа нет — задача Яндекса не отмечена')

        # Яндекс уже вошёл — задача отмечена сразу (состояние пришло, а не клик).
        logged = dict(payload)
        logged['accounts'] = {'ym': {'loggedIn': True, 'hasPlus': True, 'name': 'tester'}, 'yt': {'name': 'murzik'}}
        await E2("window.__winit(%s)" % json.dumps(logged, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        ok(await E2("document.querySelector('.wiz-task[data-task=ym]').classList.contains('done')"), 'вошёл в Яндекс — задача отмечена сразу')
        ok(await E2("document.querySelector('.wiz-task[data-task=yt]').classList.contains('done')"), 'вошёл в YouTube — задача отмечена')

        # Стример: строка про заказы из Яндекса
        await E2("window.__winit && window.__winit({type:'init',route:'streamer',step:'logins'})")
        await pg2.wait_for_timeout(120)
        await E2("window.__winit(%s)" % json.dumps(payload, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('заказ из Яндекса не сыграет' in body, 'у стримера — строка про заказы из Яндекса')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
