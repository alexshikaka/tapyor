# VO1: раздел «Видео для OBS» (Настройки → Стримерам) и страница /video.
#  - раздел есть, скрыт вместе с «Стримерам»;
#  - #voQ синхронен с #vidQ в обе стороны и пишет videoQuality;
#  - обводка: тумблер, толщина 2/4/6, цвет через окно colOpenFor → voBorder/voWidth/voColor;
#  - «Скрывать…» → voHideAudio;
#  - пока зрителей и превью нет — videoPush не вызывается; после «1 зритель» — kind video;
#  - страница /app2/video-overlay.html: состояние по SSE, рамка нужного цвета и 12 px, kind none → прозрачно.
import os, sys, json, socket, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8787   # свободный порт из диапазона замка 8774–8805

MOCK_ES = r"""
(function(){
  window.__es = [];
  function Fake(url){ this.url = url; this.readyState = 0; this.onmessage = null; window.__es.push(this); }
  Fake.prototype.close = function(){ this.readyState = 2; };
  window.EventSource = Fake;
})();
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


STATE_VIDEO = {
    'kind': 'video', 'url': 'data:video/mp4;base64,AAAA', 'ytId': '', 'cover': '',
    't': 0, 'at': 0, 'playing': False, 'rate': 1,
    'look': {'border': True, 'color': '#E5484D', 'width': 6, 'hideAudio': False},
}


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
            pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
            await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(base + '/app2/index.html')
            await pg.wait_for_timeout(900)
            E = pg.evaluate

            vis = lambda sel: E("(()=>{var e=document.querySelector('%s'); return !!e && e.offsetParent!==null})()" % sel)
            pushes = lambda: E("(window.__vpush||[]).length")

            # 1. Пока зрителей OBS нет и превью не открыто — состояние не шлём.
            await pg.wait_for_timeout(400)
            ok(await pushes() == 0, 'пока зрителей и открытого превью нет — videoPush не вызывается')

            # 2. Раздел есть в группе «Стримерам».
            await pg.click('#tabs [data-tab=settings]')
            await pg.wait_for_timeout(200)
            names = await E("Array.from(document.querySelectorAll('.set-side button[data-go]')).map(b=>b.textContent.trim())")
            ok('Видео для OBS' in names, 'в «Стримерам» есть «Видео для OBS»')
            await E("showSettingsPane('sVideo')")
            await pg.wait_for_timeout(500)
            ok(await vis('#sVideo'), 'раздел открывается')
            ok(await E("!!document.querySelector('#sVideo #voQ')"), 'в разделе есть выбор качества #voQ')
            ok('/video' in (await E("document.getElementById('voUrl').textContent")), 'показан адрес страницы /video')

            # 3. Качество: общий выбор с #vidQ (videoQuality), синхрон в обе стороны.
            await E("(()=>{var s=document.getElementById('voQ'); s.value='1080'; s.dispatchEvent(new Event('change'));})()")
            await pg.wait_for_timeout(150)
            ok(await E("document.getElementById('vidQ').value") == '1080', 'качество: #voQ → #vidQ')
            ok(await E("A.getSetting('videoQuality')") == '1080', '#voQ пишет videoQuality')
            await E("(()=>{var s=document.getElementById('vidQ'); s.value='480'; s.dispatchEvent(new Event('change'));})()")
            await pg.wait_for_timeout(150)
            ok(await E("document.getElementById('voQ').value") == '480', 'качество: #vidQ → #voQ')

            # 4. Обводка: тумблер, толщина, цвет через общее окно цвета.
            await pg.click('#voBorderTg')
            await pg.wait_for_timeout(150)
            ok(await E("A.getSetting('voBorder')") is True, 'обводка включилась и сохранилась (voBorder)')
            await pg.click('#voWidth button[data-v="6"]')
            await pg.wait_for_timeout(150)
            ok(await E("A.getSetting('voWidth')") == 6, 'толщина 6 px сохранилась (voWidth)')

            await pg.click('#voColorBtn')
            await pg.wait_for_timeout(200)
            ok(await E("!document.getElementById('colv').hidden"), 'цвет открывается общим окном выбора цвета')
            await pg.fill('#colHex', '#E5484D')
            await E("document.getElementById('colHex').dispatchEvent(new Event('change'))")
            await pg.wait_for_timeout(150)
            await pg.click('#colDone')
            await pg.wait_for_timeout(150)
            ok(str(await E("A.getSetting('voColor')")).upper() == '#E5484D', 'цвет сохранился (voColor)')

            await pg.click('#voHideAudioTg')
            await pg.wait_for_timeout(150)
            ok(await E("A.getSetting('voHideAudio')") is False, '«Скрывать…» сохраняется (voHideAudio)')

            # 5. Появился зритель OBS — уходит снимок с правильным видом.
            await E("""(function(){
              queue = [{ src:'yt', id:'abc', title:'Видео', author:'Канал' }];
              current = 0; loadingIdx = -1; mode = 'split';
              queue[0]._videoUrl = 'https://example.com/video.mp4';
              aud.src = '/loud.wav';
              window.__vpush = [];
              window.__vclients(1);
            })()""")
            await pg.wait_for_timeout(600)
            vp = json.loads(await E("JSON.stringify(window.__vpush||[])"))
            ok(len(vp) > 0, 'после «1 зритель» videoPush вызывается')
            st = vp[-1]
            ok(st.get('kind') == 'video', 'kind = video для YouTube в режиме split: ' + str(st.get('kind')))
            ok(st.get('url') == 'https://example.com/video.mp4', 'url — адрес картинки')
            look = st.get('look') or {}
            ok(look.get('border') is True and int(look.get('width')) == 6, 'в снимке обводка и толщина')
            ok(str(look.get('color', '')).upper() == '#E5484D', 'в снимке цвет обводки')
            ok(await E("!document.getElementById('voDot').hidden"), 'точка у пункта меню загорелась')

            # 6. Выключенный «Стримерам» — раздела и пункта нет.
            await pg.click('#setStreamerTg')
            await pg.wait_for_timeout(250)
            ok(not await vis('.set-side [data-go=sVideo]') and not await vis('#sVideo'), 'выкл «Стримерам» — пункта и раздела нет')
            await pg.click('#setStreamerTg')
            await pg.wait_for_timeout(250)

            # 7. Сама страница /video: состояние по SSE, рамка и скрытие.
            pg2 = await b.new_page(viewport={'width': 1280, 'height': 720})
            errs2 = []
            pg2.on('pageerror', lambda e: errs2.append(str(e)))
            await pg2.add_init_script(script=MOCK_ES)
            await pg2.goto(base + '/app2/video-overlay.html')
            await pg2.wait_for_timeout(300)
            ok(await pg2.evaluate("window.__es.length === 1"), 'страница подключилась к потоку состояния')
            ok(await pg2.evaluate("window.__es[0].url") == '/video/events', 'страница для OBS — обычный зритель')
            pg3 = await b.new_page()
            await pg3.add_init_script(script=MOCK_ES)
            await pg3.goto(base + '/app2/video-overlay.html?preview=1')
            await pg3.wait_for_timeout(300)
            ok(await pg3.evaluate("window.__es[0].url") == '/video/events?preview=1', 'превью не считается зрителем OBS (передаёт preview=1)')
            await pg3.close()
            await pg2.evaluate("(st) => { window.__es[0].onmessage({ data: JSON.stringify(st) }); }", STATE_VIDEO)
            await pg2.wait_for_timeout(300)
            css = await pg2.evaluate("""(()=>{
              var s = getComputedStyle(document.getElementById('voFrame'));
              return { r: s.borderTopLeftRadius, w: s.borderTopWidth, c: s.borderTopColor };
            })()""")
            ok(css['r'] == '12px', 'углы видео скруглены на 12 px: ' + css['r'])
            ok(css['w'] == '6px', 'толщина рамки 6 px: ' + css['w'])
            ok(css['c'] in ('rgb(229, 72, 77)', 'rgba(229, 72, 77, 1)'), 'цвет рамки нужный: ' + css['c'])
            ok(not await pg2.evaluate("document.body.classList.contains('vo-hidden')"), 'с картинкой страница видима')

            st2 = dict(STATE_VIDEO)
            st2['kind'] = 'none'
            await pg2.evaluate("(st) => { window.__es[0].onmessage({ data: JSON.stringify(st) }); }", st2)
            await pg2.wait_for_timeout(700)
            op = await pg2.evaluate("getComputedStyle(document.getElementById('voFrame')).opacity")
            ok(float(op) == 0.0, 'kind none — страница полностью прозрачна: opacity=' + str(op))

            print('ошибки:', errs)
            ok(not errs and not errs2, 'без ошибок страницы')
            await b.close()
    finally:
        srv.terminate()


try:
    asyncio.run(main())
except SystemExit:
    raise
