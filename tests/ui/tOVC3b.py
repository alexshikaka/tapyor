# OVC3, пункт 4: «Вид визуализатора» у всех стилей с визуализатором.
# Стили берём у НАСТОЯЩЕГО пака (modules/streamer-pack): у «Карточки» вид есть,
# у «Швейцарского стиля» (vizKind null, в features нет viz/osc) — нет;
# у «Кассеты» визуализатор есть по features (osc), но нет обложки.
import os, sys, json, socket, subprocess, time, urllib.request
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

INJECT = r"""
(function(){
  var A = window.app;
  A.modStatus = function(){ return fetch('/__test/status').then(function(r){ return r.json(); }); };
  A.modCmd = function(mod, cmd, arg){ return fetch('/__test/cmd', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mod:mod,cmd:cmd,arg:arg})}).then(function(r){ return r.json(); }); };
  A.onModStatus = function(){};
  A.onModPlayerWant = function(){};
  A.modPlayer = function(){};
})();
"""

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def get_json(base, path):
    with urllib.request.urlopen(base + path, timeout=3) as r:
        return json.loads(r.read())

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)

def motion_of(st):
    return (st.get('cfg') or {}).get('motion') or {}

async def main():
    port = free_port()
    base = 'http://127.0.0.1:%d' % port
    srv = subprocess.Popen(['node', os.path.join(HERE, 'ovc3_pack_server.mjs'), '--port', str(port)],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    ready = False
    for _ in range(80):
        if srv.poll() is not None: break
        try:
            get_json(base, '/__test/status'); ready = True; break
        except Exception:
            time.sleep(.1)
    if not ready:
        print('сервер пака не поднялся:', (srv.stderr.read() if srv.stderr else '')[:2000])
        srv.kill(); raise SystemExit(1)
    b = None
    try:
        styles = get_json(base, '/__test/styles')
        ok(isinstance(styles, list) and len(styles) == 26, 'пак отдал 26 стилей (сейчас %d)' % len(styles or []))
        by_id = {s['id']: s for s in styles}
        card = by_id['card']; swiss = by_id['swiss']; cassette = by_id['cassette']
        ok(card.get('vizKind') == 'spectrum', 'у «Карточки» есть визуализатор (vizKind spectrum)')
        ok(swiss.get('vizKind') is None and 'osc' not in (swiss.get('features') or []) and 'viz' not in (swiss.get('features') or []),
           'у «Швейцарского стиля» визуализатора нет (vizKind null, нет osc/viz в features)')
        ok('osc' in (cassette.get('features') or []) and 'cover' not in (cassette.get('features') or []),
           'у «Кассеты» визуализатор есть по features (osc), а обложки нет')

        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
            pg = await b.new_page(viewport={'width': 1440, 'height': 1100})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
            await pg.add_init_script(INJECT)
            await pg.goto('http://localhost:%d/app2/index.html' % port)
            await pg.wait_for_timeout(700)
            await pg.evaluate("setTab('settings'); showSettingsPane('sMotion'); ovLoad();")
            await pg.wait_for_timeout(1000)

            def state():
                return get_json(base, '/__test/state')

            def wait_state(pred, label, timeout=6):
                end = time.time() + timeout
                last = None
                while time.time() < end:
                    last = state()
                    try:
                        if pred(last): return last
                    except Exception: pass
                    time.sleep(.08)
                raise AssertionError('не дождались: ' + label)

            async def wait_ui(expr, label, timeout=5000):
                end = time.time() + timeout
                while time.time() < end:
                    try:
                        if await pg.evaluate(expr): return
                    except Exception: pass
                    await pg.wait_for_timeout(80)
                raise AssertionError('интерфейс не обновился: ' + label)

            # ── «Карточка»: подписи «Волна» / «Спектр» и общее описание ─────
            await pg.click('#motionPanel [data-ovmstyle=card]')
            wait_state(lambda s: motion_of(s).get('style') == 'card', 'моушн: стиль card')
            await wait_ui("(document.querySelector('#motionPanel .ov-style.on')||{}).getAttribute && document.querySelector('#motionPanel .ov-style.on').getAttribute('data-ovmstyle') === 'card'", 'подсветка «Карточки»')
            ok(await pg.evaluate("!!document.querySelector('#motionPanel [data-ovmv=viz]')"),
               'у «Карточки» есть «Вид визуализатора»')
            labels = await pg.evaluate("Array.from(document.querySelectorAll('#motionPanel [data-ovmv=viz]')).map(function(b){return b.textContent})")
            ok(labels == ['Волна', 'Спектр'], 'подписи вида — «Волна» / «Спектр» (сейчас %s)' % labels)
            panel = await pg.evaluate("document.getElementById('motionPanel').innerText")
            low = panel.lower()
            ok('общую громкость' in low and 'низы, середина и верх' in low,
               'описание вида — общий принцип: волна под громкость, спектр — частоты по отдельности')
            ok('(текущая)' not in panel and '32 полосы' not in panel,
               'в подписях нет DOS-подробностей «текущая» и «32 полосы»')
            desc_row = await pg.evaluate("(function(){var b=document.querySelector('#motionPanel [data-ovmv=viz]'); if(!b) return ''; var r=b.closest('.srow'); return r?r.innerText:'';})()")
            ok('Волна — одна плавная форма' in desc_row and 'Спектр — низы' in desc_row,
               'описание строки вида — из OVERLAYS-VIZ.md')

            await pg.click('#motionPanel [data-ovmv=viz][data-val=spectrum]')
            wait_state(lambda s: motion_of(s).get('viz') == 'spectrum', 'вид = spectrum')
            wait_state(lambda s: any((f.get('cfg') or {}).get('motion', {}).get('viz') == 'spectrum' for f in s['feeds']),
                       'вид spectrum в превью')
            await wait_ui("(document.querySelector('#motionPanel [data-ovmv=viz][data-val=spectrum]')||{}).classList.contains('on')", 'подсветка «Спектра»')
            ok(await pg.evaluate("(document.querySelector('#motionPanel [data-ovmv=viz][data-val=spectrum]')||{}).classList.contains('on')"),
               '«Спектр» сохранился и подсветился')
            await pg.click('#motionPanel [data-ovmv=viz][data-val=wave]')
            wait_state(lambda s: motion_of(s).get('viz') == 'wave', 'вид назад = wave')

            # ── Все 26 стилей: вид есть ровно там, где есть визуализатор ─────
            for s in styles:
                sid = s['id']
                has_viz = (s.get('vizKind') is not None) or ('viz' in (s.get('features') or []))
                await pg.click('#motionPanel [data-ovmstyle=%s]' % sid)
                wait_state(lambda st, sid=sid: motion_of(st).get('style') == sid, 'стиль ' + sid)
                await wait_ui("(document.querySelector('#motionPanel .ov-style.on')||{}).getAttribute && document.querySelector('#motionPanel .ov-style.on').getAttribute('data-ovmstyle') === '%s'" % sid,
                              'подсветка ' + sid)
                got = await pg.evaluate("!!document.querySelector('#motionPanel [data-ovmv=viz]')")
                ok(got == has_viz, 'стиль %s: «Вид визуализатора» %s' % (sid, 'есть' if has_viz else 'нет'))
                if not has_viz:
                    ok(not await pg.evaluate("!!document.querySelector('#motionPanel [data-ovmvc]')"),
                       'стиль %s: цвета визуализатора тоже нет' % sid)

            # ── «Кассета»: визуализатор есть, обложки нет ────────────────────
            await pg.click('#motionPanel [data-ovmstyle=cassette]')
            wait_state(lambda s: motion_of(s).get('style') == 'cassette', 'стиль cassette')
            await wait_ui("(document.querySelector('#motionPanel .ov-style.on')||{}).getAttribute && document.querySelector('#motionPanel .ov-style.on').getAttribute('data-ovmstyle') === 'cassette'", 'подсветка «Кассеты»')
            ok(await pg.evaluate("!!document.querySelector('#motionPanel [data-ovmv=viz]')"),
               'у «Кассеты» вид визуализатора есть (в features — osc)')
            ok(not await pg.evaluate("!!document.querySelector('#motionPanel [data-ovmt=cover]')"),
               'у «Кассеты» нет переключателя обложки (её нет в features)')

            # ── Вкладка плейлиста: тот же принцип ────────────────────────────
            await pg.click('#goOverlay')
            await pg.wait_for_timeout(900)
            await pg.click('#ovCtl [data-ovstyle=card]')
            wait_state(lambda s: (s.get('cfg') or {}).get('style') == 'card', 'плейлист: стиль card')
            await wait_ui("!!document.querySelector('#ovCtl [data-ovv=viz]')", 'плейлист: вид у «Карточки»')
            ok(True, 'плейлист: у «Карточки» «Вид визуализатора» есть')
            await pg.click('#ovCtl [data-ovstyle=swiss]')
            wait_state(lambda s: (s.get('cfg') or {}).get('style') == 'swiss', 'плейлист: стиль swiss')
            await wait_ui("!document.querySelector('#ovCtl [data-ovv=viz]')", 'плейлист: у «Швейцарского» вида нет')
            ok(True, 'плейлист: у стиля без визуализатора вида нет')

            print('ошибки:', errs)
            ok(not errs, 'без ошибок страницы')
            await b.close()
    finally:
        if b:
            try: await b.close()
            except Exception: pass
        srv.terminate()
        try: srv.wait(timeout=5)
        except Exception: srv.kill()

try:
    import asyncio
    asyncio.run(main())
except SystemExit:
    raise
