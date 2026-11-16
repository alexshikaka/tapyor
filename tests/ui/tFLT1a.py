# FLT1a (15.11.2026): фильтр ленты сообщений — Все · Донаты · Твич чат · Баллы канала.
# Во вкладке «Заказы» и в док-панели OBS (/widget).
import os, asyncio, subprocess, json
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8776
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

FILL = """(function(){
  var now = Date.now();
  function msg(k, name, prov, bot){ return { key: k, name: name, prov: prov, bot: !!bot, amount: bot ? null : 100, currency: 'RUB',
    text: 'песня ' + name, level: 'text', items: [], state: 'new', got: now - 1000, at: now - 1000 }; }
  RQ.list = [ msg('d1', 'Донатер', 'da'), msg('d2', 'Донатер2', 'dp'), msg('c1', 'Чатер', 'twitch-cmd', true),
              msg('c2', 'ЧатерSB', 'sb-cmd', true), msg('p1', 'Баллер', 'twitch-points', true) ];
  setTab('req'); rqRender(); return true; })()"""

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
        await E("try{localStorage.removeItem('tapRqFeedSrc')}catch(e){}; RQ_FEED_SRC='all'; true")
        await E(FILL)
        await pg.wait_for_timeout(150)
        btns = await E("[].map.call(document.querySelectorAll('#rqList .rq-flt button'), function(b){return b.textContent.trim()})")
        ok(btns == ['Все 5', 'Донаты 2', 'Твич чат 2', 'Баллы канала 1'], 'в ленте кнопки с числами: %r' % btns)
        cnt = lambda: E("document.querySelectorAll('#rqList .rq-feed > .rq').length")
        ok(await cnt() == 5, '«Все» — пять сообщений')
        for f, n, who in (('don', 2, 'Донатер'), ('chat', 2, 'Чатер'), ('pts', 1, 'Баллер')):
            await pg.click('#rqList [data-rqf=%s]' % f)
            await pg.wait_for_timeout(80)
            ok(await cnt() == n, '%s — %d сообщ.' % (f, n))
            kinds = await E("[].map.call(document.querySelectorAll('#rqList .rq-feed > .rq'), function(x){return x.dataset.kind})")
            ok(all(k == f for k in kinds), 'показаны только «%s»' % f)
        ok(await E("localStorage.getItem('tapRqFeedSrc')") == 'pts', 'выбор запоминается')
        await pg.click('#rqList [data-rqf=all]')
        await pg.wait_for_timeout(80)
        ok(await cnt() == 5, 'снова все')
        feed = await E("widgetFeedHtml()")
        ok(feed.count('data-kind="chat"') == 2 and feed.count('data-kind="don"') == 2, 'карточки для док-панели несут вид сообщения')

        # Док-панель OBS: подменяем поток состояния
        pg2 = await b.new_page(viewport={'width': 420, 'height': 700})
        pg2.on('pageerror', lambda e: errs.append('dock: ' + str(e)))
        await pg2.add_init_script("""
          window.EventSource = function(){ window.__es = this; };
          window.EventSource.prototype.close = function(){};
          var of = window.fetch; window.fetch = function(u){ if (String(u).indexOf('/widget/') === 0) return new Promise(function(){}); return of.apply(this, arguments); };
        """)
        # Панель грузит /widget.js и /app.css от корня сервера Тапёра — в тесте они лежат в app2/
        async def to_app2(route):
            u = route.request.url
            await route.continue_(url=u.replace('/widget.js', '/app2/widget.js').replace('/app.css', '/app2/app.css'))
        await pg2.route('**/widget.js', to_app2)
        await pg2.route('**/app.css', to_app2)
        await pg2.goto('http://127.0.0.1:%d/app2/widget.html' % PORT)
        await pg2.wait_for_timeout(300)
        E2 = pg2.evaluate
        st = {'feedHtml': feed, 'msgCount': 5, 'np': {'title': '', 'playing': False}, 'reqAuto': False}
        await E2("window.__es.onmessage({data: %s})" % json.dumps(json.dumps(st, ensure_ascii=False)))
        await pg2.wait_for_timeout(120)
        vis = lambda: E2("[].filter.call(document.querySelectorAll('#feed .rq'), function(x){return getComputedStyle(x).display !== 'none'}).length")
        ok(await vis() == 5, 'в панели видно все 5')
        dbtn = await E2("[].map.call(document.querySelectorAll('#flt button'), function(b){return b.textContent.replace(/\\s+/g,' ').trim()})")
        ok(dbtn == ['Все 5', 'Донаты 2', 'Твич чат 2', 'Баллы канала 1'], 'в панели те же кнопки: %r' % dbtn)
        await pg2.click('#flt [data-f=pts]')
        ok(await vis() == 1, 'панель: «Баллы канала» — одно')
        await pg2.click('#flt [data-f=chat]')
        ok(await vis() == 2, 'панель: «Твич чат» — два')
        # Новое состояние пришло — фильтр остаётся
        st['feedHtml'] = feed + ' '
        await E2("window.__es.onmessage({data: %s})" % json.dumps(json.dumps(st, ensure_ascii=False)))
        await pg2.wait_for_timeout(120)
        ok(await vis() == 2, 'после обновления ленты фильтр сохранён')

        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
