# WZ2c: шаг «Музыка с компьютера» — своей кнопки выбора папки больше нет: шаг подсвечивает
# настоящую кнопку «Добавить папку…» в Настройках, а задача отмечается, когда главное окно
# сообщило, что папок ≥ 1. Список папок и прогресс остаются сводкой.
import os, asyncio, subprocess, json
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8803
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

def flat(s):
    return (s or '').replace('\u00a0', ' ')

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

        await E("""
          (function () {
            window.__count = 0;
            window.__lp = null;
            window.__lc = null;
            window.app.libStatus = function () {
              return Promise.resolve({ count: window.__count, folders: window.__count ? [{ path: 'C:\\\\Музыка', count: window.__count }] : [] });
            };
            window.app.onLibProgress = function (fn) { window.__lp = fn; };
            window.app.onLibChanged = function (fn) { window.__lc = fn; };
            window.app.libAddFolder = function (dir) {
              window.__libAsked = dir;
              window.__count = 2;
              return Promise.resolve({ ok: true, count: 2, added: 2, status: { count: 2, folders: [{ path: 'C:\\\\Музыка', count: 2 }] } });
            };
            return true;
          })()
        """)
        await E("window.__wcmd({op:'do',name:'localWatch',args:{on:true}})")
        await pg.wait_for_timeout(250)
        ev = await E("(window.__wevents||[]).filter(function(e){return e.type==='local'}).slice(-1)[0]")
        ok(bool(ev), 'шаг получает состояние библиотеки')
        ok(ev.get('status', {}).get('count') == 0, 'пока песен нет — 0')
        ok(ev.get('web') is True, 'площадки не проверялись — не пугаем «недоступны»')

        # Настоящая кнопка добавления папки — подсвечена и работает.
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sLocal',sel:'#setLibAdd'})")
        await pg.wait_for_timeout(300)
        ok(await E("document.getElementById('setLibAdd').textContent.indexOf('Добавить папку') >= 0"),
           'в «Музыке с компьютера» есть настоящая кнопка «Добавить папку…»')
        ok(await E("document.getElementById('setLibAdd').hasAttribute('data-wiz-hl')"), 'она подсвечена')
        await E("document.getElementById('setLibAdd').click()")
        await pg.wait_for_timeout(300)
        ok(await E("window.__libAsked") == '', 'кнопка зовёт тот же выбор папки Тапёра (libAddFolder)')
        ok(await E("window.__count") == 2, 'папка добавилась')
        # Главное окно сообщает о смене библиотеки — визард получает новые папки.
        await E("window.__lc && window.__lc({count:2, folders:[{path:'C:\\\\Музыка', count:2}]})")
        await pg.wait_for_timeout(300)
        ev2 = await E("(window.__wevents||[]).filter(function(e){return e.type==='local' && e.status && e.status.count===2}).slice(-1)[0]")
        ok(bool(ev2), 'после добавления папки приходит новое состояние')
        ok(len(ev2['status']['folders']) == 1 and ev2['status']['folders'][0]['path'].endswith('Музыка'), 'папка и её путь доехали')

        # Чтение идёт фоном: прогресс приходит событиями, ничего не блокирует.
        await E("window.__lp && window.__lp({done:1,total:2})")
        await pg.wait_for_timeout(120)
        pr = await E("(window.__wevents||[]).filter(function(e){return e.type==='local' && e.progress}).slice(-1)[0]")
        ok(pr['progress']['done'] == 1 and pr['progress']['total'] == 2, 'прогресс чтения приходит по ходу')
        await E("window.__lp && window.__lp({done:2,total:2,finished:true})")
        await pg.wait_for_timeout(250)
        fin = await E("(window.__wevents||[]).filter(function(e){return e.type==='local' && e.progress && e.progress.finished}).slice(-1)[0]")
        ok(bool(fin), 'конец чтения отмечен')
        ok(await E("typeof WIZ_ACTIONS === 'object' && !('localPick' in WIZ_ACTIONS)"), 'действие своей кнопки (localPick) убрано')

        # Окно визарда: задача на настоящую кнопку, сводка папок и прогресс.
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
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'local'})")
        await pg2.wait_for_timeout(120)
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Есть музыка на компьютере?', 'шаг «Музыка с компьютера» открылся')
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'do' and c.get('name') == 'localWatch' and c.get('args', {}).get('on') is True for c in calls), 'шаг просит следить за библиотекой')
        hl = [c for c in calls if c.get('op') == 'highlight']
        ok(bool(hl) and hl[-1].get('pane') == 'sLocal' and hl[-1].get('sel') == '#setLibAdd',
           'подсвечена настоящая кнопка «Добавить папку…» в Настройках')
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Добавь папку с музыкой' in body, 'задача «Добавь папку с музыкой»')
        ok('по желанию' in body, 'папка — по желанию')
        ok(await E2("document.querySelectorAll('[data-act]').length") == 0 and 'Выбрать папку' not in body,
           'своей кнопки «Выбрать папку» нет')

        payload = {
            'type': 'local', 'web': False,
            'status': {'count': 0, 'folders': []},
            'progress': {'done': 412, 'total': 1380, 'finished': False}
        }
        await E2("window.__winit(%s)" % json.dumps(payload, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        body = flat(await E2("document.getElementById('wizBody').textContent"))
        ok('Сейчас онлайн-площадки недоступны' in body and 'музыка с компьютера играет всегда' in body,
           'если онлайн недоступен — текст сильнее (как в макете)')
        ok('Читаю файлы… 412 из 1 380' in body and 'можно идти дальше' in body, 'прогресс «N из M · можно идти дальше»')
        ok(await E2("document.querySelector('.wiz-task[data-task=folder]').classList.contains('done')") is False,
           'папок нет — задача не отмечена')

        done = {
            'type': 'local', 'web': True,
            'status': {'count': 2, 'folders': [{'path': 'C:\\Музыка', 'count': 2}]},
            'progress': {'done': 2, 'total': 2, 'finished': True}
        }
        await E2("window.__winit(%s)" % json.dumps(done, ensure_ascii=False))
        await pg2.wait_for_timeout(150)
        body = flat(await E2("document.getElementById('wizBody').textContent"))
        ok(await E2("document.querySelector('.wiz-task[data-task=folder]').classList.contains('done')"),
           'главное окно сообщило про папку — задача отмечена')
        ok('C:\\Музыка' in body, 'показан путь выбранной папки')
        ok('Нашлось: 2 песни' in body, 'после чтения — сколько нашлось')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
