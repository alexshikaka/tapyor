# DOCK2a (16.11.2026): страница /dock2 — вторая док-панель OBS («Пульт плейлиста»).
# Открываем app2/dock2.html и подменяем EventSource/fetch: рисуем снимок, проверяем команды.
import os, asyncio, subprocess, json, time
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8777
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

def item(i, title, st='', req=None, ban=False, can_next=False, book=None):
    return {'i': i, 'key': 'ym:%d' % (i + 1), 'title': title, 'artist': 'Артист %d' % (i + 1),
            'src': 'ym', 'srcName': 'Яндекс', 'dur': '3:%02d' % (10 + i), 'thumb': '',
            'st': st, 'bg': False, 'req': req, 'ban': ban, 'canNext': can_next, 'book': book}

def snapshot(now):
    return {
        'v': 1, 'at': now, 'mode': 'classic', 'cur': 0,
        'np': {'title': 'Играет сейчас', 'artist': 'Артист', 'playing': True, 'pos': 30, 'dur': 200},
        'items': [
            item(0, 'Играющий трек', 'playing'),
            item(1, 'Сыгранный трек', 'done'),
            item(2, 'Донат', 'pend', {'kind': 'don', 'who': 'Донатер'}, can_next=True),
            item(3, 'Заказ Твича', 'pend', {'kind': 'cmd', 'who': 'Чатер'}, can_next=True),
            item(4, 'Заказ за баллы', 'pend', {'kind': 'pts', 'who': 'Баллер'}, can_next=True),
            item(5, 'Обычный трек', 'pend', can_next=True)
        ],
        'after': [{'key': 'ym:777', 'title': 'Дальше в волне', 'artist': 'Волна', 'thumb': ''}],
        'wave': {'title': 'Волна', 'sub': 'по настроению', 'auto': True},
        'counts': {'pending': 4, 'played': 1},
        'opts': {'ban': False, 'banMin': 10},
        'look': {'cls': '', 'style': '', 'scale': 100},
        'theme': {'vars': {}, 'light': False}
    }

def hex_rgb(h):
    h = h.strip()
    if not h.startswith('#'):
        return h
    if len(h) == 4:
        h = '#' + h[1] * 2 + h[2] * 2 + h[3] * 2
    return 'rgb(%d, %d, %d)' % (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 360, 'height': 720})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("""
          window.__cmds = [];
          window.EventSource = function(){ window.__es = this; };
          window.EventSource.prototype.close = function(){};
          window.fetch = function(u, opts){
            var s = String(u);
            if (s === '/dock2/cmd' && opts && opts.body) {
              try { window.__cmds.push(JSON.parse(opts.body)); } catch (e) {}
            }
            return Promise.resolve({ ok: true, status: 204, json: function(){ return Promise.resolve({}); } });
          };
        """)
        # Страница просит файлы от корня сервера Тапёра — в тесте они лежат в app2/.
        RULES = {'/dock2.js': '/app2/dock2.js', '/dock2.css': '/app2/dock2.css',
                 '/app.css': '/app2/app.css', '/assets/icon.png': '/app2/assets/icon.png'}
        async def to_app2(route):
            u = route.request.url
            path = u.split('?')[0]
            if '/app2/' in path:
                return await route.continue_()
            for a, bb in RULES.items():
                if path.endswith(a):
                    return await route.continue_(url=u.replace(a, bb, 1))
            await route.continue_()
        for a in RULES:
            await pg.route('**' + a, to_app2)
        await pg.goto('http://127.0.0.1:%d/app2/dock2.html' % PORT)
        await pg.wait_for_timeout(350)
        E = pg.evaluate

        # Связь: пока EventSource молчит — красная точка
        on = await E("document.getElementById('d2conn').classList.contains('on')")
        dot = await E("getComputedStyle(document.querySelector('#d2conn i')).backgroundColor")
        ok(not on and dot == 'rgb(255, 90, 82)', 'нет связи — красная точка %r' % dot)
        await E("window.__es.onopen()")
        await pg.wait_for_timeout(60)
        ok(await E("document.getElementById('d2conn').classList.contains('on')"), 'связь появилась — точка зелёная')

        snap = snapshot(int(time.time() * 1000))
        payload = json.dumps(snap, ensure_ascii=False)
        await E("window.__es.onmessage({data: %s})" % json.dumps(payload, ensure_ascii=False))
        await pg.wait_for_timeout(150)

        rows = await E("[].map.call(document.querySelectorAll('#d2list .d2-row'), function(r){return r.querySelector('.d2-title').textContent})")
        ok(len(rows) == 6 and rows[0] == 'Играющий трек' and rows[5] == 'Обычный трек', 'строки показаны: %r' % rows)
        # 16.11 (владелец): без переключателя режима и без «Моей волны»; шапка и подвал — как у панели с сообщениями
        ok(await E("!document.getElementById('d2mode') && !document.getElementById('d2wavePlay')"), 'нет переключателя режима и карточки волны')
        ok(await E("Math.round(document.querySelector('.d2-head').getBoundingClientRect().height)") == 34, 'шапка 34 px, как у первой панели')
        ok(await E("Math.round(document.querySelector('.d2-bar').getBoundingClientRect().height)") == 43, 'подвал 43 px, как у первой панели')
        tm = await E("document.getElementById('d2time').textContent")
        ok(tm.startswith('0:30'), 'время в подвале: %r' % tm)

        # У заказов — свои цвета (из переменных темы)
        colors = await E("""(function(){
          var out = {};
          document.querySelectorAll('#d2list .d2-row').forEach(function(r){
            out[r.getAttribute('data-i')] = getComputedStyle(r.querySelector('.d2-title')).color;
          });
          return out;
        })()""")
        vars = await E("""(function(){ var cs = getComputedStyle(document.documentElement); return {
          req: cs.getPropertyValue('--req').trim(), cmd: cs.getPropertyValue('--req-cmd').trim(),
          pts: cs.getPropertyValue('--req-pts').trim(), tx: cs.getPropertyValue('--tx').trim() }; })()""")
        ok(colors['2'] == hex_rgb(vars['req']), 'донат — цвет --req (%r)' % colors['2'])
        ok(colors['3'] == hex_rgb(vars['cmd']), 'заказ Твича — цвет --req-cmd (%r)' % colors['3'])
        ok(colors['4'] == hex_rgb(vars['pts']), 'заказ за баллы — цвет --req-pts (%r)' % colors['4'])
        ok(colors['5'] == hex_rgb(vars['tx']), 'обычный трек — цвет --tx (%r)' % colors['5'])

        # ⛔: при ban:false кнопки нет; при ban:true в item — только у заказов Твича
        bans = await E("[].map.call(document.querySelectorAll('#d2list .d2-ban'), function(b){return parseInt(b.closest('.d2-row').getAttribute('data-i'), 10)})")
        ok(bans == [], 'при opts.ban=false кнопки ⛔ нет: %r' % bans)
        snap['opts']['ban'] = True
        snap['items'][3]['ban'] = True
        snap['items'][4]['ban'] = True
        payload = json.dumps(snap, ensure_ascii=False)
        await E("window.__es.onmessage({data: %s})" % json.dumps(payload, ensure_ascii=False))
        await pg.wait_for_timeout(120)
        bans = await E("[].map.call(document.querySelectorAll('#d2list .d2-ban'), function(b){return parseInt(b.closest('.d2-row').getAttribute('data-i'), 10)})")
        ok(bans == [3, 4], '⛔ только у заказов Твича (3 и 4): %r' % bans)

        # Крестик: remove с верными i и key
        await pg.click('#d2list .d2-row[data-i="5"] .d2-x')
        await pg.wait_for_timeout(80)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd == {'c': 'remove', 'i': 5, 'key': 'ym:6'}, 'крестик шлёт remove: %r' % cmd)

        # Перетаскивание: строку 5 бросаем до строки 1 → move, to=1
        await E("""(function(){
          var rows = document.querySelectorAll('#d2list .d2-row');
          var src = rows[5], dst = rows[1];
          var dt = new DataTransfer();
          src.dispatchEvent(new DragEvent('dragstart', {bubbles:true, cancelable:true, dataTransfer:dt}));
          var rc = dst.getBoundingClientRect();
          dst.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer:dt, clientY:rc.top + 1}));
          dst.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:dt, clientY:rc.top + 1}));
          src.dispatchEvent(new DragEvent('dragend', {bubbles:true, cancelable:true, dataTransfer:dt}));
          return true;
        })()""")
        await pg.wait_for_timeout(80)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd == {'c': 'move', 'i': 5, 'key': 'ym:6', 'to': 1}, 'перетаскивание шлёт move: %r' % cmd)

        # Поиск: 300 мс, новый id; выдача показывается, «+ В очередь» шлёт add
        await pg.fill('#d2q', 'тест')
        await pg.wait_for_timeout(450)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd and cmd.get('c') == 'search' and cmd.get('q') == 'тест' and len(cmd.get('id', '')) <= 40,
           'ввод шлёт search с id: %r' % cmd)
        sid = cmd['id']
        ev = {'ev': 'search', 'id': sid, 'q': 'тест', 'done': True, 'items': [
            {'r': 'r1', 'title': 'Найденный трек', 'artist': 'Артист', 'src': 'ym', 'srcName': 'Яндекс', 'dur': '3:20', 'thumb': ''},
            {'r': 'r2', 'title': 'Второй трек', 'artist': 'Другой', 'src': 'yt', 'srcName': 'YouTube', 'dur': '4:00', 'thumb': ''}
        ]}
        await E("window.__es.onmessage({data: %s})" % json.dumps(json.dumps(ev, ensure_ascii=False), ensure_ascii=False))
        await pg.wait_for_timeout(120)
        n = await E("document.querySelectorAll('#d2find .d2-fr').length")
        shown = await E("!document.getElementById('d2find').hidden")
        ok(n == 2 and shown, 'событие search показывает выдачу: %d' % n)
        await pg.click('#d2find .d2-fr:first-child [data-fa="add"]')
        await pg.wait_for_timeout(80)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd == {'c': 'add', 'r': 'r1'}, '«+ В очередь» шлёт add с r: %r' % cmd)

        # Старая выдача (чужой id) не открывает список
        old = dict(ev, id='old-id')
        await E("window.__es.onmessage({data: %s})" % json.dumps(json.dumps(old, ensure_ascii=False), ensure_ascii=False))
        await pg.wait_for_timeout(80)
        n2 = await E("document.querySelectorAll('#d2find .d2-fr').length")
        ok(n2 == 2, 'выдача старого id не подменила текущую')

        # Esc закрывает (даже когда фокус на кнопке выдачи)
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(80)
        ok(await E("document.getElementById('d2find').hidden"), 'Esc закрывает выдачу')

        # ↑/↓/Enter: новый поиск, стрелка вниз на второй результат, Enter — playnow
        await pg.fill('#d2q', 'тест два')
        await pg.wait_for_timeout(450)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd and cmd.get('c') == 'search' and cmd.get('q') == 'тест два', 'повторный ввод — новый search: %r' % cmd)
        ev2 = dict(ev, id=cmd['id'], q='тест два')
        await E("window.__es.onmessage({data: %s})" % json.dumps(json.dumps(ev2, ensure_ascii=False), ensure_ascii=False))
        await pg.wait_for_timeout(100)
        await pg.keyboard.press('ArrowDown')
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(80)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd == {'c': 'playnow', 'r': 'r2'}, '↓ и Enter шлют playnow: %r' % cmd)
        await pg.keyboard.press('Escape')

        # Логотип в подвале — focus
        await pg.click('#d2logo')
        await pg.wait_for_timeout(80)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd == {'c': 'focus'}, 'логотип шлёт focus: %r' % cmd)

        # Оформление: классы и масштаб на <html>, как у первой панели
        snap['look'] = {'cls': 'yami yami-obs', 'style': '--bg0:#101010', 'scale': 110}
        payload = json.dumps(snap, ensure_ascii=False)
        await E("window.__es.onmessage({data: %s})" % json.dumps(payload, ensure_ascii=False))
        await pg.wait_for_timeout(100)
        cls = await E("document.documentElement.className")
        zoom = await E("document.documentElement.style.zoom")
        ok(cls == 'yami yami-obs', 'look.cls ставит классы на <html>: %r' % cls)
        ok(zoom == '1.1', 'look.scale даёт масштаб 110%%: %r' % zoom)
        corner = await E("getComputedStyle(document.querySelector('#d2list .d2-row')).borderRadius")
        ok(corner == '0px', 'Yami: прямые углы (%r)' % corner)

        # Живой режим: строки «Дальше в волне» показываются
        snap['mode'] = 'live'
        payload = json.dumps(snap, ensure_ascii=False)
        await E("window.__es.onmessage({data: %s})" % json.dumps(payload, ensure_ascii=False))
        await pg.wait_for_timeout(100)
        ok(await E("document.querySelectorAll('#d2after .d2-ar').length") == 1, 'живая очередь: «Дальше в волне»')
        ok(await E("document.getElementById('d2after').parentElement.id === 'd2scroll' && document.getElementById('d2list').parentElement.id === 'd2scroll'"), 'плейлист и «Дальше в волне» — одна прокрутка')
        await pg.click('#d2after .d2-ar')
        await pg.wait_for_timeout(50)
        cmd = await E("window.__cmds[window.__cmds.length-1]")
        ok(cmd == {'c': 'waveat', 'j': 0, 'key': 'ym:777'}, 'нажатие на трек волны шлёт waveat: %r' % cmd)

        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
