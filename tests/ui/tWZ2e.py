# WZ2e: шаг «Плейлисты» — заметка с демо-списком (30 песен), «Скопировать», импорт в
# Тапёре на вкладке «Текст», «Вставь за меня», ловля вставки и конца сборки, «Играть»/«Играть фоном».
import os, asyncio, subprocess, json
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8774
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

        # Демо возможно: Яндекс отвечает (значит, песни найдутся)
        await E("""
          (function () {
            window.QC.items = {
              'ym.svc': { id: 'ym.svc', state: 'ok', text: 'доступен' },
              'yt.svc': { id: 'yt.svc', state: 'bad', text: 'не отвечает' },
              'sc':     { id: 'sc', state: 'bad', text: 'не отвечают' }
            };
            return true;
          })()
        """)
        await E("window.__wcmd({op:'do',name:'importWatch',args:{on:true}})")
        await E("window.__wcmd({op:'do',name:'importInfo'})")
        await pg.wait_for_timeout(200)
        info = await E("(window.__wevents||[]).filter(function(e){return e.type==='import' && e.stage==='info'}).slice(-1)[0]")
        ok(bool(info) and info.get('canDemo') is True, 'шаг узнаёт, что демо пройдёт')

        await E("window.__wcmd({op:'do',name:'importOpen'})")
        await pg.wait_for_timeout(300)
        ok(await E("!!document.getElementById('impPaste')"), 'в Тапёре открыт импорт и вкладка «Текст»')
        ok(await E("(function(){var b=document.querySelector('.ar-tabs [data-it=text]');return !!b && b.classList.contains('on')})()"),
           'активна вкладка «Текст»')
        ok(await E("!!document.querySelector('#myPl .imp')"), 'импорт нарисован в «Плейлистах»')

        # «Вставь за меня»: текст встаёт в поле вставки
        await E("window.__wcmd({op:'do',name:'importPaste',args:{text:'Queen — Bohemian Rhapsody (1975)\\n1. Michael Jackson — Billie Jean (1982)\\n2. The Beatles — Hey Jude (1968)'}})")
        await pg.wait_for_timeout(250)
        paste = await E("document.getElementById('impPaste').value")
        ok('Bohemian Rhapsody' in paste and len(paste.split('\n')) == 3, 'текст демо вставлен в поле импорта')
        go_txt = await E("document.getElementById('impGo').textContent")
        ok('3' in go_txt, 'кнопка «Собрать плейлист» считает строки: ' + go_txt)
        ok(await E("document.getElementById('impPasteOk').hidden") is False, 'после вставки видно «✓ Вставлено N строк»')
        ev = await E("(window.__wevents||[]).filter(function(e){return e.type==='import' && e.stage==='pasted'}).slice(-1)[0]")
        ok(bool(ev) and ev.get('n') == 3, 'визард поймал вставку — событие pasted с числом строк')

        # Конец сборки: главное окно само замечает, что все строки разобраны
        await E("""
          (function () {
            window.imp = {
              title: 'Хиты всех времён', done: 1,
              items: [{ track: { src: 'ym', id: 'w1', albumId: '1', title: 'Bohemian Rhapsody', author: 'Queen', duration: '5:55', thumb: '' }, status: 'exact' }]
            };
            return true;
          })()
        """)
        await pg.wait_for_timeout(800)
        done = await E("(window.__wevents||[]).filter(function(e){return e.type==='import' && e.stage==='done'}).slice(-1)[0]")
        ok(bool(done) and done.get('found') == 1, 'конец сборки пойман — событие done с числом песен')

        # «Играть»: плейлист сохраняется и включается тем же путём, что «Играть фоном»
        await E("window.__wcmd({op:'do',name:'importPlay'})")
        await pg.wait_for_timeout(1500)
        saved = await E("window.app.getSetting('savedLists')")
        ok(bool(saved) and len(saved) >= 1, 'собранный демо-плейлист сохранён в Тапёр')
        ok(bool(saved) and saved[0].get('title') == 'Хиты всех времён' and len(saved[0].get('tracks') or []) == 1,
           'в нём ровно собранные песни')
        qlen = await E("window.queue.length")
        ok(qlen >= 1, 'и сразу поставлен играть (%d в очереди)' % qlen)

        # Окно визарда: демо, копирование, кнопки, подписи веток
        errs2 = []
        pg2 = await b.new_page(viewport={'width': 380, 'height': 820})
        await pg2.add_init_script("""
          window.__wcalls = [];
          Object.defineProperty(Navigator.prototype, 'clipboard', {
            configurable: true,
            get: function () { return { writeText: function (t) { window.__copied = t; return Promise.resolve(); } }; }
          });
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
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'playlists'})")
        await pg2.wait_for_timeout(120)
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Любой список — в плейлист', 'шаг «Плейлисты» открылся')
        calls = await E2("window.__wcalls")
        ok(any(c.get('name') == 'importInfo' for c in calls), 'шаг спрашивает, можно ли показать демо')
        ok(any(c.get('name') == 'importWatch' and c.get('args', {}).get('on') is True for c in calls), 'и включает слежение за импортом')

        await E2("window.__winit(%s)" % json.dumps({'type': 'import', 'stage': 'info', 'canDemo': True}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        calls = await E2("window.__wcalls")
        ok(any(c.get('name') == 'importOpen' for c in calls), 'демо возможно — визард сам открывает импорт')
        ok(any(c.get('op') == 'highlight' and c.get('sel') == '#impPaste' for c in calls), 'и подсвечивает поле вставки')
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Заметка · скинули список песен' in body and 'ещё 27 строк' in body, 'заметка с демо-списком (30 песен)')
        ok('Ctrl' in body and 'в подсвеченное поле слева' in body, 'инструкция «Нажми Ctrl + V»')
        ok('Номера и годы оставь как есть' in body, 'подсказка про номера и годы')
        # Список кладётся в буфер сам, без нажатия «Скопировать» (замечание владельца 15.11)
        auto = await E2("window.__copied || ''")
        ok(auto.startswith('Queen — Bohemian Rhapsody (1975)'), 'список сам попал в буфер при открытии импорта')
        ok('Скопировано' in await E2("document.querySelector('[data-act=copy]').textContent"), 'кнопка сразу показывает «✓ Скопировано»')
        await E2("window.__copied = ''")

        # «Скопировать»: в буфер уходит весь список владельца
        await pg2.click('[data-act="copy"]')
        await pg2.wait_for_timeout(150)
        copied = await E2("window.__copied || ''")
        lines = [x for x in copied.split('\n') if x.strip()]
        ok(lines and lines[0] == 'Queen — Bohemian Rhapsody (1975)', '«Скопировать» кладёт список в буфер')
        ok(len(lines) == 30, 'в буфере ровно 30 песен владельца')
        btn = await E2("document.querySelector('[data-act=copy]').textContent")
        ok('Скопировано' in btn, 'кнопка подтверждает: «✓ Скопировано»')

        # «Вставь за меня» — запасной путь для Ctrl+V
        await pg2.click('[data-act="pasteMe"]')
        await pg2.wait_for_timeout(100)
        calls = await E2("window.__wcalls")
        last = calls[-1] if calls else {}
        ok(last.get('name') == 'importPaste' and len([x for x in (last.get('args', {}).get('text') or '').split('\n') if x.strip()]) == 30,
           '«Вставь за меня» шлёт все 30 строк в главное окно')

        await E2("window.__winit(%s)" % json.dumps({'type': 'import', 'stage': 'pasted', 'n': 30}, ensure_ascii=False))
        await pg2.wait_for_timeout(100)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Есть! Теперь «Собрать плейлист»' in body, 'поймали вставку — «Есть! Теперь "Собрать плейлист"»')
        calls = await E2("window.__wcalls")
        ok(any(c.get('op') == 'highlight' and c.get('sel') == '#impGo' for c in calls), 'подсвечена кнопка «Собрать плейлист»')

        await E2("window.__winit(%s)" % json.dumps({'type': 'import', 'stage': 'done', 'found': 30, 'previews': 0, 'total': 30}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Собрано 30 песен' in body and 'Номера и годы Тапёр убрал сам' in body, 'после сборки — сколько собрано и что номера убраны')
        ok(await E2("document.querySelector('[data-act=play]').textContent") == 'Играть', 'у слушателя кнопка «Играть»')
        await pg2.click('[data-act="play"]')
        await pg2.wait_for_timeout(150)
        calls = await E2("window.__wcalls")
        ok(any(c.get('name') == 'importPlay' for c in calls), '«Играть» запускает плейлист в главном окне')
        ok(await E2("document.getElementById('wizTitle').textContent") == 'Твой плейлист уже играет', 'и ведёт к шагу «Очередь»')

        # Стример: «Играть фоном» + подсказка про фон
        await E2("window.__wcalls.length = 0")
        await E2("window.__winit && window.__winit({type:'init',route:'streamer',step:'playlists'})")
        await pg2.wait_for_timeout(120)
        await E2("window.__winit(%s)" % json.dumps({'type': 'import', 'stage': 'info', 'canDemo': True}, ensure_ascii=False))
        await E2("window.__winit(%s)" % json.dumps({'type': 'import', 'stage': 'done', 'found': 30, 'previews': 0, 'total': 30}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        ok(await E2("document.querySelector('[data-act=play]').textContent") == 'Играть фоном', 'у стримера кнопка «Играть фоном»')

        # Демо невозможно: ни площадок, ни музыки с компьютера — шаг объясняет и не открывает импорт
        await E2("window.__wcalls.length = 0")
        await E2("window.__winit && window.__winit({type:'init',route:'listener',step:'playlists'})")
        await pg2.wait_for_timeout(120)
        await E2("window.__winit(%s)" % json.dumps({'type': 'import', 'stage': 'info', 'canDemo': False}, ensure_ascii=False))
        await pg2.wait_for_timeout(120)
        body = await E2("document.getElementById('wizBody').textContent")
        ok('Демо пока не пройдёт' in body, 'если играть нечему — демо пропускается с объяснением')
        calls = await E2("window.__wcalls")
        ok(not any(c.get('name') == 'importOpen' for c in calls), 'и импорт зря не открывается')

        print('ошибки:', errs + errs2)
        ok(not errs and not errs2, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
