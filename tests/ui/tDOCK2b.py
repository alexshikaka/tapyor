# DK1: вторая док-панель OBS «Пульт плейлиста» — снимок очереди и команды (сторона окна Тапёра).
#  - без зрителей dock2Push не вызывается; после onDock2Clients(1) приходит снимок по формату docs/DOCK2.md;
#  - remove с верным ключом убирает трек, с неверным — нет и приходит toast;
#  - ban выключен — ничего; включён — убирает заказ Твича и не трогает донат;
#  - move меняет порядок, mode переключает режим;
#  - search отдаёт только треки (книга с speech выкинута), add по r добавляет трек в очередь;
#  - карточка #d2Url/#d2Copy/#d2Ban есть в настройках, тумблер пишет dock2Ban.
import os, sys, json, socket, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8778

MOCK_D2 = r"""
(function(){
  window.__d2 = { push: [], events: [] };
  window.__bot = [];
  var app = window.app;
  app.dock2Url = function(){ return Promise.resolve('http://127.0.0.1:8790/dock2'); };
  app.dock2Push = function(s){ window.__d2.push.push(s); };
  app.dock2Event = function(e){ window.__d2.events.push(e); };
  app.onDock2Cmd = function(cb){ window.__d2.cmd = cb; };
  app.onDock2Clients = function(cb){ window.__d2.clients = cb; };
  app.botOrder = function(type, key, extra){ window.__bot.push([type, key, extra]); };
})();
"""

# Очередь из 5 треков: заказ Твича (индекс 2) и донат (индекс 3). Первый — играет.
FILL = r"""
(function(){
  function tr(src, id, title, author){ return { src:src, id:String(id), title:title, author:author,
    duration:'3:00', seconds:180, thumb:'https://example.com/' + id + '.jpg' }; }
  var a = tr('ym','1','Первый','Артист');
  var b = tr('ym','2','Второй','Артист');
  var c = tr('ym','3','Заказ Твича','Артист');
  var d = tr('ym','4','Донат','Артист');
  var e = tr('ym','5','Пятый','Артист');
  c.req = { key:'twitch-cmd:viewer1', who:'Зритель' };
  d.req = { key:'da:don1', who:'Донатер' };
  queue = [a,b,c,d,e];
  current = 0; loadingIdx = -1; mode = 'split';
  try { aud.src = '/loud.wav'; } catch (err) {}
  document.body.classList.remove('is-paused');
  window.__d2.push = []; window.__d2.events = []; window.__bot = [];
  return true;
})()
"""


def port_free(port):
    s = socket.socket()
    try:
        s.bind(('127.0.0.1', port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)


async def main():
    if not port_free(PORT):
        print('✗ порт %d занят другим тестом — освободи и запусти снова' % PORT)
        raise SystemExit(1)
    if not os.path.exists(os.path.join(HERE, 'loud.wav')):
        subprocess.run([sys.executable, 'gen_audio.py'], cwd=HERE, check=False)
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                           cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = 'http://127.0.0.1:%d' % PORT
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
            pg = await b.new_page(viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
            await pg.add_init_script(script=MOCK_D2)
            await pg.goto(base + '/app2/index.html')
            await pg.wait_for_timeout(900)
            E = pg.evaluate

            pushes = lambda: E("window.__d2.push.length")

            # 1. Зрителей нет — снимок не собираем и не шлём.
            await E(FILL)
            await pg.wait_for_timeout(100)
            ok(await E("!!window.__d2.cmd && !!window.__d2.clients"), 'мост пульта подключён (команды и зрители)')
            await E("dock2Push(true)")
            await pg.wait_for_timeout(100)
            ok(await pushes() == 0, 'без зрителей dock2Push не вызывается')

            # 2. Появился зритель — сразу приходит снимок с правильной очередью.
            await E("window.__d2.clients(1)")
            await pg.wait_for_timeout(250)
            snaps = json.loads(await E("JSON.stringify(window.__d2.push)"))
            ok(len(snaps) >= 1, 'после «1 зритель» приходит снимок')
            snap = snaps[-1]
            ok(snap.get('v') == 1 and snap.get('mode') == 'classic' and snap.get('cur') == 0, 'снимок: версия, режим и играющий трек')
            ok(snap['np']['title'] == 'Первый' and snap['np']['playing'] is True, 'np: что играет и что играет сейчас')
            items = snap['items']
            ok([x['key'] for x in items] == ['ym:1', 'ym:2', 'ym:3', 'ym:4', 'ym:5'], 'items — вся очередь в порядке: %r' % [x['key'] for x in items])
            ok([x['st'] for x in items] == ['playing', 'pend', 'pend', 'pend', 'pend'], 'st строк как в renderQueue: %r' % [x['st'] for x in items])
            ok(items[0]['req'] is None and items[2]['req']['kind'] == 'cmd' and items[2]['req']['who'] == 'Зритель', 'req заказа Твича (cmd) и ник')
            ok(items[3]['req']['kind'] == 'don', 'req доната — don')
            ok(items[2]['req']['sb'] is False, 'sb — признак заказа Streamer.bot')
            ok(items[0]['canNext'] is False and items[2]['canNext'] is True, 'canNext как у кнопки «Играть следующим»')
            ok(items[2]['ban'] is False, '⛔ скрыт, пока dock2Ban выключен')
            ok(snap['counts'] == {'pending': 4, 'played': 0}, 'счётчики очереди: %r' % snap['counts'])
            ok(snap['opts']['ban'] is False and snap['opts']['banMin'] == 10, 'opts: dock2Ban и BOT_BAN_MIN')
            ok(int(snap['look']['scale']) == 100 and 'cls' in snap['look'] and 'style' in snap['look'], 'look: класс, стиль и масштаб')
            ok(isinstance(snap['theme']['vars'], dict) and '--bg0' in snap['theme']['vars'], 'theme.vars — готовые цвета для телефона')
            ok(isinstance(snap['theme']['light'], bool), 'theme.light — признак светлой темы')

            # 3. remove: верный ключ убирает нужный трек, неверный — нет и toast.
            await E("window.__d2.cmd({ c:'remove', i:2, key:'ym:3' })")
            await pg.wait_for_timeout(200)
            ids = await E("queue.map(function(v){return v.id})")
            ok(ids == ['1', '2', '4', '5'], 'remove с верным ключом убрал именно трек 3: %r' % ids)
            n = await E("queue.length")
            await E("window.__d2.cmd({ c:'remove', i:0, key:'ym:zzz' })")
            await pg.wait_for_timeout(200)
            ok(await E("queue.length") == n, 'remove с неверным ключом ничего не убрал')
            evs = json.loads(await E("JSON.stringify(window.__d2.events)"))
            ok(any(e.get('ev') == 'toast' and 'Очередь изменилась' in e.get('text', '') for e in evs), 'при неверном ключе — toast «Очередь изменилась»')

            # 4. ban: выключен — ничего, включён — убирает заказ Твича и не трогает донат.
            await E(FILL)
            await E("D2.ban = false")
            await E("window.__d2.cmd({ c:'ban', i:2, key:'ym:3' })")
            await pg.wait_for_timeout(200)
            ok(await E("queue.length") == 5, 'ban при выключенной настройке ничего не делает')
            bot = json.loads(await E("JSON.stringify(window.__bot || [])"))
            ok(not any(x[0] == 'ban' for x in bot), 'при выключенной настройке заказы не закрываются')
            await E("D2.ban = true")
            await E("dock2Push(true)")
            await pg.wait_for_timeout(200)
            snaps = json.loads(await E("JSON.stringify(window.__d2.push)"))
            ok(any(x['key'] == 'ym:3' and x['ban'] is True for x in snaps[-1]['items']), 'при включённой настройке в снимке есть бан у заказа')
            await E("window.__d2.cmd({ c:'ban', i:2, key:'ym:3' })")
            await pg.wait_for_timeout(250)
            ids = await E("queue.map(function(v){return v.id})")
            ok('3' not in ids and '4' in ids, 'ban убрал заказ Твича и не тронул донат: %r' % ids)
            bot = json.loads(await E("JSON.stringify(window.__bot || [])"))
            ok(any(x[0] == 'ban' for x in bot), 'зрителю закрыты заказы (botOrder ban)')

            # 5. move меняет порядок.
            await E(FILL)
            await E("D2.ban = false")
            await E("window.__d2.cmd({ c:'move', i:0, key:'ym:1', to:3 })")
            await pg.wait_for_timeout(200)
            ids = await E("queue.map(function(v){return v.id})")
            ok(ids == ['2', '3', '1', '4', '5'], 'move переставил трек: %r' % ids)

            # 6. mode переключает режим.
            await E("window.__d2.cmd({ c:'mode', m:'live' })")
            await pg.wait_for_timeout(200)
            ok(await E("qMode") == 'live' and (await E("isClassic()")) is False, 'mode переключил на живую очередь')

            # 6б. waveat (16.11): трек из «Дальше в волне» включается; чужой ключ — ничего не делает.
            await E("(function(){ bgSel = { kind: 'wave', station: 'user:onyourwave', name: 'Моя волна' }; waveBuf = [{ id: 'w1', src: 'ym', title: 'Волна 1', author: 'А' }, { id: 'w2', src: 'ym', title: 'Волна 2', author: 'Б' }]; window.__pw = []; })()")
            await E("window.__d2.cmd({ c:'waveat', j: 1, key: 'ym:чужой' })")
            await pg.wait_for_timeout(150)
            ok(await E("waveBuf.length") == 2, 'waveat с чужим ключом ничего не делает')
            await E("window.__d2.cmd({ c:'waveat', j: 1, key: 'ym:w2' })")
            await pg.wait_for_timeout(150)
            qids = await E("queue.map(function(v){ return v.id; })")
            ok('w2' in qids and 'w1' not in qids, 'waveat поставил в очередь нужный трек волны (w2): %r' % qids)
            await E("waveBuf = []")

            # 7. search: только треки, книга с speech выкинута, два события done false/true.
            await E("""(function(){
              window.app.ymSearch = function(){ return Promise.resolve({
                tracks: [
                  { src:'ym', id:'s1', title:'Найденный', author:'Группа', duration:'3:00', seconds:180, thumb:'https://x/1.jpg' },
                  { src:'ym', id:'b1', title:'Глава книги', author:'Автор', speech:true, seconds:200, thumb:'' }
                ],
                artists: [{ id:'a1', name:'Группа' }],
                playlists: [{ src:'ym', type:'playlist', uid:'1', kind:'3', title:'Плейлист', count: 2, thumb:'' }]
              }); };
              window.app.ytSearch = function(){ return Promise.resolve({
                videos: [{ id:'v1', title:'Видео', author:'Канал', duration:'2:00', seconds:120, thumb:'https://x/v.jpg' }],
                playlists: [{ src:'yt', type:'playlist', listId:'PL1', title:'Плейлист YouTube', count: 1, thumb:'' }]
              }); };
              window.app.scSearch = function(){ return Promise.resolve([]); };
              window.app.auSearch = function(){ return Promise.resolve([]); };
              window.app.libSearch = function(){ return Promise.resolve([]); };
              LIB.count = 0;
              window.__d2.events = [];
              return true;
            })()""")
            await E("window.__d2.cmd({ c:'search', q:'найденный', id:'s1' })")
            await pg.wait_for_timeout(1000)
            evs = json.loads(await E("JSON.stringify(window.__d2.events)"))
            se = [e for e in evs if e.get('ev') == 'search']
            ok(len(se) == 2, 'search прислал два события (done false и true): %d' % len(se))
            ok(se[0].get('done') is False and se[-1].get('done') is True, 'события идут с done:false, затем done:true')
            ok(all(e.get('id') == 's1' for e in se), 'события несут id поиска')
            sitems = se[-1]['items']
            titles = [x['title'] for x in sitems]
            ok('Глава книги' not in titles, 'книга с speech выкинута из выдачи')
            ok('Найденный' in titles and 'Видео' in titles, 'в выдаче треки Яндекса и YouTube: %r' % titles)
            ok(len(sitems) == 2, 'плейлисты и исполнители в выдачу не попали: %r' % titles)
            ok(all(x.get('r') and x.get('title') and x.get('artist') for x in sitems), 'у каждого трека есть токен r и подписи')

            # 8. add по r добавляет трек в очередь.
            r = next(x['r'] for x in sitems if x['title'] == 'Найденный')
            await E("(function(){ mode = 'split'; aud.src = '/loud.wav'; current = 0; })()")
            before = await E("queue.length")
            await E("window.__d2.cmd({ c:'add', r: %s })" % json.dumps(r))
            await pg.wait_for_timeout(300)
            ok(await E("queue.length") == before + 1, 'add по r добавил трек в очередь')
            ok(await E("queue[queue.length-1].title") == 'Найденный', 'добавлен именно выбранный трек')

            # 9. Карточка настроек и тумблер dock2Ban.
            ok(await E("!!document.querySelector('#sObs #d2Url') && !!document.querySelector('#sObs #d2Copy') && !!document.querySelector('#sObs #d2Open') && !!document.querySelector('#sObs #d2Ban')"),
               'в настройках OBS есть карточка пульта (#d2Url, #d2Copy, #d2Open, #d2Ban)')
            ok('/dock2' in (await E("document.getElementById('d2Url').textContent")), 'показан адрес страницы /dock2')
            before_ban = await E("D2.ban")
            await E("document.getElementById('d2Ban').click()")
            await pg.wait_for_timeout(200)
            ok(await E("D2.ban") == (not before_ban), 'тумблер переключает D2.ban')
            ok(await E("window.app.getSetting('dock2Ban')") == (not before_ban), 'настройка dock2Ban сохраняется')

            print('ошибки:', errs)
            ok(not errs, 'без ошибок страницы')
            await b.close()
    finally:
        srv.terminate()


try:
    asyncio.run(main())
except SystemExit:
    raise
