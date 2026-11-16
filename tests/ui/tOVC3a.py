# OVC3, пункты 1–3 и 5: вкладка «Моушн-оверлей» с НАСТОЯЩИМ паком из modules/streamer-pack.
# Модуль пака поднимает тестовый сервер ovc3_pack_server.mjs: он отдаёт окно Тапёра и страницы пака
# на одном origin, сохраняет настройки через настоящий settings.js и отдаёт странице превью тот же
# снимок, что и в OBS. Проверяем каждый элемент вкладки: нажали → в motion.* новое значение →
# iframe превью получил этот cfg. Заодно коротко проходим вкладку плейлиста.
import os, sys, json, socket, subprocess, time, urllib.request
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SHOTS = os.environ.get('OVC3_SHOTS')
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

INJECT = r"""
(function(){
  var A = window.app;
  A.modStatus = function(){ return fetch('/__test/status').then(function(r){ return r.json(); }); };
  A.modCmd = function(mod, cmd, arg){ return fetch('/__test/cmd', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mod:mod,cmd:cmd,arg:arg})}).then(function(r){ return r.json(); }); };
  A.onModStatus = function(){};
  A.onModPlayerWant = function(){};
  A.modPlayer = function(){};
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function(t){
    window.__copied = t; return Promise.resolve(); } } }); } catch (e) {}
})();
"""

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def get_json(base, path):
    with urllib.request.urlopen(base + path, timeout=2) as r:
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
            await pg.wait_for_timeout(900)

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
                    time.sleep(.1)
                raise AssertionError('не дождались: ' + label + '\nstate=' + json.dumps(last, ensure_ascii=False)[:1200])

            def wait_motion(key, val, label, timeout=6):
                st = wait_state(lambda s: motion_of(s).get(key) == val, label, timeout)
                wait_state(lambda s: any((f.get('cfg') or {}).get('motion', {}).get(key) == val for f in s['feeds']),
                           label + ' — cfg в превью', timeout)
                return st

            async def frame_eval(js):
                fr = [f for f in pg.frames if '/overlay/motion?preview=1' in f.url]
                if not fr: return None
                return await fr[-1].evaluate(js)

            async def wait_ui(expr, label, timeout=6000):
                end = time.time() + timeout
                while time.time() < end:
                    try:
                        if await pg.evaluate(expr): return
                    except Exception:
                        pass
                    await pg.wait_for_timeout(100)
                raise AssertionError('интерфейс не обновился: ' + label)

            async def src_now():
                return await pg.evaluate("document.getElementById('ovMFrame').getAttribute('src')")

            async def assert_no_reload(before, label):
                ok(await src_now() == before, label + ': iframe не перезагружен (адрес прежний)')

            await wait_ui("document.querySelectorAll('#motionPanel [data-ovmstyle]').length >= 20", 'сетка стилей моушна')
            await wait_ui("!!document.getElementById('ovMFrame') && document.getElementById('ovMFrame').getAttribute('src').indexOf('/overlay/motion?preview=1') >= 0", 'адрес превью моушна')
            await pg.wait_for_timeout(900)

            def clickable(name):
                return name

            # ── Настоящий пак: 26 стилей, моушн-превью подключено к настоящему модулю ──
            n = await pg.evaluate("document.querySelectorAll('#motionPanel [data-ovmstyle]').length")
            ok(n == 26, 'вкладка моушна показывает 26 стилей настоящего пака (сейчас %d)' % n)
            ok('/overlay/motion?preview=1' in (await src_now() or ''), 'превью — настоящая страница пака /overlay/motion?preview=1')
            st = wait_state(lambda s: len(s['feeds']) > 0, 'страница превью получила первый снимок')
            ok(motion_of(st).get('style') == 'dos', 'стартовый стиль моушна — DOS (из настоящих настроек)')
            title = await frame_eval("(document.querySelector('[data-role=title]') || {}).textContent")
            ok('Звезда по имени Солнце' in (title or ''), 'страница превью показывает играющий трек из снимка плеера')
            ok(await pg.evaluate("document.querySelectorAll('#motionPanel [data-ovmpos]').length") == 6, 'угол — 6 кнопок')

            # ── Стиль: цвета стиля + «Что показывать» под стиль ──────────────────
            before = await src_now()
            await pg.click('#motionPanel [data-ovmstyle=card]')
            st = wait_motion('style', 'card', 'стиль моушна = card')
            m = motion_of(st)
            ok(m.get('color') == '#FFFFFF' and m.get('vizColor') == '#F0654F',
               'смена стиля поставила его цвета (#FFFFFF / #F0654F)')
            on_style = await pg.evaluate("(document.querySelector('#motionPanel .ov-style.on')||{}).getAttribute && document.querySelector('#motionPanel .ov-style.on').getAttribute('data-ovmstyle')")
            if on_style != 'card':
                await wait_ui("(document.querySelector('#motionPanel .ov-style.on')||{}).getAttribute && document.querySelector('#motionPanel .ov-style.on').getAttribute('data-ovmstyle') === 'card'", 'подсветка «Карточки»')
                on_style = await pg.evaluate("(document.querySelector('#motionPanel .ov-style.on')||{}).getAttribute && document.querySelector('#motionPanel .ov-style.on').getAttribute('data-ovmstyle')")
            ok(on_style == 'card', 'кнопка «Карточка» стала выбранной (было: %s)' % on_style)
            await wait_ui("document.querySelectorAll('#motionPanel [data-ovmt]').length === 5", 'перестройка «Что показывать» под «Карточку»')
            toggles = await pg.evaluate("Array.from(document.querySelectorAll('#motionPanel [data-ovmt]')).map(function(e){return e.dataset.ovmt})")
            ok(toggles == ['outline', 'cover', 'osc', 'marq', 'nick'],
               '«Что показывать» перестроилось под «Карточку»: %s' % toggles)
            await assert_no_reload(before, 'смена стиля')
            vc = await frame_eval("document.getElementById('ov').style.getPropertyValue('--c').toUpperCase()")
            ok(vc == '#FFFFFF', 'превью применило цвет нового стиля (--c %s)' % vc)

            # Назад на DOS — там есть все пункты, проверим каждый
            await pg.click('#motionPanel [data-ovmstyle=dos]')
            wait_motion('style', 'dos', 'стиль моушна назад = dos')
            await wait_ui("document.querySelectorAll('#motionPanel [data-ovmt]').length === 8", 'возврат пунктов DOS')
            toggles = await pg.evaluate("Array.from(document.querySelectorAll('#motionPanel [data-ovmt]')).map(function(e){return e.dataset.ovmt})")
            ok(toggles == ['outline', 'cover', 'time', 'spin', 'osc', 'prog', 'marq', 'nick'],
               'у DOS в моушне все пункты «Что показывать»: %s' % toggles)

            # ── Угол, сдвиг, размер, сброс ───────────────────────────────────────
            for pos in ('tc', 'tr', 'bl', 'bc', 'br', 'tl'):
                before = await src_now()
                await pg.click('#motionPanel [data-ovmpos=%s]' % pos)
                wait_motion('pos', pos, 'угол моушна = ' + pos)
                await wait_ui("(document.querySelector('#motionPanel [data-ovmpos=%s]')||{}).classList.contains('on')" % pos,
                              'подсветка угла ' + pos)
                ok(await pg.evaluate("(document.querySelector('#motionPanel [data-ovmpos=%s]')||{}).classList.contains('on')" % pos),
                   'кнопка угла %s показывает сохранённое значение' % pos)
                await pg.wait_for_timeout(180)
                hv = await frame_eval("(function(){var o=document.getElementById('ov'); return [o.dataset.h,o.dataset.v];})()")
                ok(hv == [pos[1], pos[0]], 'превью встало в угол %s (data-h/v = %s)' % (pos, hv))
                await assert_no_reload(before, 'угол ' + pos)

            before = await src_now()
            await pg.evaluate("(function(){var e=document.getElementById('ovMDx'); e.value='40'; e.dispatchEvent(new Event('change',{bubbles:true}));})()")
            wait_motion('dx', 40, 'сдвиг X = 40')
            await pg.evaluate("(function(){var e=document.getElementById('ovMDy'); e.value='-24'; e.dispatchEvent(new Event('change',{bubbles:true}));})()")
            wait_motion('dy', -24, 'сдвиг Y = -24')
            await assert_no_reload(before, 'сдвиг')

            before = await src_now()
            await pg.evaluate("(function(){var e=document.getElementById('ovMSize'); e.value='240'; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            st = wait_motion('size', 240, 'размер моушна = 240 %')
            ok('240 %' in await pg.evaluate("document.getElementById('ovMSizeV').textContent"), 'подпись размера показывает 240 %')
            await assert_no_reload(before, 'размер')

            # ── Сценарий появления: все четыре кнопки ───────────────────────────
            for scene, label in (('rush', 'Выезд с акцентом'), ('mask', 'Маска и штрих'), ('plate', 'Полупрозрачная подводка'), ('brand', 'Фирменный')):
                before = await src_now()
                await pg.click('#motionPanel [data-ovmscene][data-val=%s]' % scene)
                wait_motion('scene', scene, 'сценарий = ' + scene)
                await wait_ui("(document.querySelector('#motionPanel [data-ovmscene][data-val=%s]')||{}).classList.contains('on')" % scene, 'подсветка сценария ' + scene)
                ok(await pg.evaluate("(document.querySelector('#motionPanel [data-ovmscene][data-val=%s]')||{}).classList.contains('on')" % scene),
                   'кнопка сценария «%s» выбранная' % label)
                await assert_no_reload(before, 'сценарий ' + scene)

            # ── Сколько держать ─────────────────────────────────────────────────
            before = await src_now()
            await pg.evaluate("(function(){var e=document.getElementById('ovMHold'); e.value='9'; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            wait_motion('hold', 9, 'держать = 9 с')
            ok('9 с' in await pg.evaluate("document.getElementById('ovMHoldT').textContent"), 'заголовок «Сколько держать» показывает 9 с')
            await assert_no_reload(before, 'сколько держать')

            # ── Тумблеры: ник, обводка, «Что показывать» ───────────────────────
            async def toggle(key, want, label, iframe_check=None):
                before = await src_now()
                await pg.click('#motionPanel [data-ovmt=%s]' % key)
                wait_motion(key, want, '%s = %s' % (label, want))
                await wait_ui("(document.querySelector('#motionPanel [data-ovmt=%s]')||{}).classList.contains('on') === %s" % (key, 'true' if want else 'false'), 'подсветка «%s»' % label)
                ok(await pg.evaluate("(document.querySelector('#motionPanel [data-ovmt=%s]')||{}).classList.contains('on')" % key) == want,
                   'кнопка «%s» показывает сохранённое значение' % label)
                await assert_no_reload(before, label)
                if iframe_check:
                    await pg.wait_for_timeout(150)
                    got = await frame_eval(iframe_check[0])
                    ok(got == iframe_check[1], '%s — превью: %s (%s)' % (label, iframe_check[2], got))

            await toggle('outline', False, 'Чёрная обводка', ("document.getElementById('ov').classList.contains('outline')", False, 'обводки нет'))
            await toggle('outline', True, 'Чёрная обводка', ("document.getElementById('ov').classList.contains('outline')", True, 'обводка вернулась'))
            await toggle('cover', False, 'Обложка', ("document.getElementById('ov').classList.contains('no-cover')", True, 'обложка скрыта'))
            await toggle('cover', True, 'Обложка', ("document.getElementById('ov').classList.contains('no-cover')", False, 'обложка вернулась'))
            await toggle('time', False, 'Время', ("(function(){var e=document.querySelector('[data-role=time]'); return e ? e.hidden : null;})()", True, 'время скрыто'))
            await toggle('time', True, 'Время', ("(function(){var e=document.querySelector('[data-role=time]'); return e ? e.hidden : null;})()", False, 'время вернулось'))
            await toggle('spin', False, 'Курсор-вертушка', ("(function(){var e=document.querySelector('[data-role=spin]'); return e ? e.hidden : null;})()", True, 'вертушка скрыта'))
            await toggle('spin', True, 'Курсор-вертушка', ("(function(){var e=document.querySelector('[data-role=spin]'); return e ? e.hidden : null;})()", False, 'вертушка вернулась'))
            await toggle('prog', False, 'Шкала прогресса', ("(function(){var e=document.querySelector('[data-role=prog]'); return e ? e.hidden : null;})()", True, 'шкала скрыта'))
            await toggle('prog', True, 'Шкала прогресса', ("(function(){var e=document.querySelector('[data-role=prog]'); return e ? e.hidden : null;})()", False, 'шкала вернулась'))
            await toggle('osc', False, 'Визуализатор', ("(function(){var e=document.querySelector('[data-role=viz]'); return e ? e.hidden : null;})()", True, 'визуализатор скрыт'))
            await toggle('osc', True, 'Визуализатор', ("(function(){var e=document.querySelector('[data-role=viz]'); return e ? e.hidden : null;})()", False, 'визуализатор вернулся'))
            await toggle('marq', False, 'Бегущая строка', None)
            await toggle('marq', True, 'Бегущая строка', None)

            # Подписи TRACK/ARTIST ↔ ТРЕК/АРТИСТ
            await pg.click('#motionPanel [data-ovmv=lang][data-val=ru]')
            wait_motion('lang', 'ru', 'подписи = ru')
            await pg.wait_for_timeout(300)
            lang_now = await frame_eval("(function(){var r=document.querySelector('#ov [data-lang]'); return r ? r.dataset.lang : null;})()")
            ok(lang_now == 'ru', 'превью переключило подписи на ТРЕК/АРТИСТ (data-lang %s)' % lang_now)
            await pg.click('#motionPanel [data-ovmv=lang][data-val=en]')
            wait_motion('lang', 'en', 'подписи = en')

            # Ник: у DOS в разметке пака нет места под ник, поэтому проверяем на «Карточке»,
            # где элемент [data-role=who] реально есть.
            await pg.click('#motionPanel [data-ovmstyle=card]')
            wait_motion('style', 'card', 'ник: стиль card')
            await wait_ui("document.querySelectorAll('#motionPanel [data-ovmt]').length === 5", 'ник: пункты «Карточки»')
            await toggle('nick', False, 'Показать ник заказавшего', ("(function(){var w=document.querySelector('[data-role=who]'); return w ? w.hidden : null;})()", True, 'ник скрыт'))
            await toggle('nick', True, 'Показать ник заказавшего', ("(function(){var w=document.querySelector('[data-role=who]'); return w ? w.hidden : null;})()", False, 'ник снова виден'))
            await pg.click('#motionPanel [data-ovmstyle=dos]')
            wait_motion('style', 'dos', 'ник: назад на DOS')
            await wait_ui("document.querySelectorAll('#motionPanel [data-ovmt]').length === 8", 'ник: пункты DOS вернулись')

            # ── Цвета: готовые, свой цвет, пипетка в окне ──────────────────────
            before = await src_now()
            await pg.click('#motionPanel [data-ovmc="#33FF66"]')
            wait_motion('color', '#33FF66', 'цвет текста = #33FF66')
            await pg.wait_for_timeout(300)
            c = await frame_eval("document.getElementById('ov').style.getPropertyValue('--c').toUpperCase()")
            ok(c == '#33FF66', 'превью применило цвет текста (--c %s)' % c)
            await assert_no_reload(before, 'цвет текста')

            # свой цвет через окно цвета
            await pg.click('#motionPanel [data-ovmpick=color]')
            await pg.wait_for_selector('#colv:not([hidden])')
            ok(await pg.evaluate("!!document.getElementById('colPip')"), 'в окне выбора цвета есть пипетка')
            await pg.evaluate("(function(){var e=document.getElementById('colHex'); e.value='#123456'; e.dispatchEvent(new Event('change',{bubbles:true}));})()")
            wait_motion('color', '#123456', 'свой цвет текста = #123456')
            await pg.wait_for_timeout(300)
            c = await frame_eval("document.getElementById('ov').style.getPropertyValue('--c').toUpperCase()")
            ok(c == '#123456', 'свой цвет текста доехал до превью (--c %s)' % c)
            await pg.click('#colDone')

            before = await src_now()
            await pg.click('#motionPanel [data-ovmvc="#4FD8FF"]')
            wait_motion('vizColor', '#4FD8FF', 'цвет визуализатора = #4FD8FF')
            await pg.wait_for_timeout(300)
            v = await frame_eval("document.getElementById('ov').style.getPropertyValue('--v').toUpperCase()")
            ok(v == '#4FD8FF', 'превью применило цвет визуализатора (--v %s)' % v)
            await assert_no_reload(before, 'цвет визуализатора')

            await pg.click('#motionPanel [data-ovmpick=vizColor]')
            await pg.wait_for_selector('#colv:not([hidden])')
            await pg.evaluate("(function(){var e=document.getElementById('colHex'); e.value='#ABCDEF'; e.dispatchEvent(new Event('change',{bubbles:true}));})()")
            wait_motion('vizColor', '#ABCDEF', 'свой цвет визуализатора = #ABCDEF')
            await pg.click('#colDone')

            # ── Вид визуализатора и плавность ──────────────────────────────────
            before = await src_now()
            await pg.click('#motionPanel [data-ovmv=viz][data-val=spectrum]')
            wait_motion('viz', 'spectrum', 'вид визуализатора = spectrum')
            await wait_ui("(document.querySelector('#motionPanel [data-ovmv=viz][data-val=spectrum]')||{}).classList.contains('on')", 'подсветка «Спектр»')
            ok(await pg.evaluate("(document.querySelector('#motionPanel [data-ovmv=viz][data-val=spectrum]')||{}).classList.contains('on')"),
               'кнопка «Спектр» выбранная')
            await assert_no_reload(before, 'вид визуализатора')
            await pg.click('#motionPanel [data-ovmv=viz][data-val=wave]')
            wait_motion('viz', 'wave', 'вид визуализатора = wave')

            before = await src_now()
            await pg.click('#motionPanel [data-ovmv=smooth][data-val=slow]')
            wait_motion('smooth', 'slow', 'плавность = slow')
            await wait_ui("(document.querySelector('#motionPanel [data-ovmv=smooth][data-val=slow]')||{}).classList.contains('on')", 'подсветка «Плавно»')
            ok(await pg.evaluate("(document.querySelector('#motionPanel [data-ovmv=smooth][data-val=slow]')||{}).classList.contains('on')"),
               'кнопка «Плавно» выбранная')
            await assert_no_reload(before, 'плавность')

            # ── Сбросить: возвращает угол, сдвиг и размер ─────────────────────
            await pg.click('#motionPanel [data-ovmpos=tr]')
            wait_motion('pos', 'tr', 'перед сбросом угол = tr')
            await pg.evaluate("(function(){var e=document.getElementById('ovMDx'); e.value='60'; e.dispatchEvent(new Event('change',{bubbles:true}));})()")
            wait_motion('dx', 60, 'перед сбросом X = 60')
            await pg.evaluate("(function(){var e=document.getElementById('ovMSize'); e.value='200'; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            wait_motion('size', 200, 'перед сбросом размер = 200')
            await pg.click('#motionPanel [data-ova=reset-mpos]')
            st = wait_state(lambda s: motion_of(s).get('pos') == 'bc' and motion_of(s).get('dx') == 0
                              and motion_of(s).get('dy') == 0 and motion_of(s).get('size') == 100, 'сброс положения моушна')
            await wait_ui("document.getElementById('ovMSize').value === '100'", 'размер после сброса')
            await wait_ui("(document.querySelector('#motionPanel [data-ovmpos=bc]')||{}).classList.contains('on')", 'угол после сброса')
            ok(await pg.evaluate("document.getElementById('ovMSize').value") == '100', 'после сброса ползунок показывает 100 %')
            ok(await pg.evaluate("(document.querySelector('#motionPanel [data-ovmpos=bc]')||{}).classList.contains('on')"),
               'после сброса выбран угол «снизу по центру»')
            hv = await frame_eval("(function(){var o=document.getElementById('ov'); return [o.dataset.h,o.dataset.v];})()")
            ok(hv == ['c', 'b'], 'превью после сброса встало в bc')

            # ── Показать сейчас ───────────────────────────────────────────────
            n0 = state()['shows']
            await pg.click('#motionPanel [data-ova=preview-motion]')
            wait_state(lambda s: any(c['cmd'] == 'preview-motion' for c in s['cmds']), 'команда preview-motion')
            wait_state(lambda s: s['shows'] > n0, 'событие show ушло странице превью')
            await pg.wait_for_timeout(250)
            ok(await frame_eval("document.getElementById('ov').classList.contains('motion-in')"),
               'превью проиграло появление после «Показать сейчас»')

            # ── Скопировать ───────────────────────────────────────────────────
            await pg.click('#motionPanel [data-ova=copy-motion]')
            await pg.wait_for_timeout(200)
            copied = await pg.evaluate("window.__copied || ''")
            ok(copied == 'http://localhost:%d/overlay/motion' % port, '«Скопировать» кладёт ссылку моушн-оверлея')

            # ── Снимки вкладки моушна (тёмная/светлая) ────────────────────────
            if SHOTS:
                os.makedirs(SHOTS, exist_ok=True)
                await pg.set_viewport_size({'width': 1440, 'height': 3000})
                await pg.evaluate("var t=document.getElementById('toast'); if(t) t.hidden=true;"
                                  "var r=document.getElementById('motionPanel'); if(r && r.parentElement) r.parentElement.scrollTop=0;"
                                  "var si=document.querySelector('.set-in'); if(si){ si.style.height='auto'; si.style.maxHeight='none'; }"
                                  "var m=document.querySelector('.set-main'); if(m){ m.style.overflow='visible'; m.style.maxHeight='none'; }"
                                  "document.querySelectorAll('.ov-sticky').forEach(function(e){ e.style.position='static'; });")
                await pg.evaluate("showSettingsPane('sMotion')")
                await pg.wait_for_timeout(600)
                await pg.evaluate("document.querySelectorAll('.ov-sticky').forEach(function(e){ e.style.position='static'; });")
                for theme, name in (('dark', 'dark'), ('dark-l', 'light')):
                    await pg.evaluate("applyTheme('%s', false)" % theme)
                    await pg.wait_for_timeout(450)
                    loc = pg.locator('#sMotion')
                    await loc.screenshot(path=os.path.join(SHOTS, 'ovc3-motion-%s.png' % name))
                print('снимки:', SHOTS)
                await pg.evaluate("applyTheme('dark', false)")
                await pg.set_viewport_size({'width': 1440, 'height': 1100})
                await pg.wait_for_timeout(300)

            # ── Коротко вкладка плейлиста: те же кнопки работают ─────────────
            await pg.click('#goOverlay')
            await pg.wait_for_timeout(900)
            await wait_ui("document.querySelectorAll('#ovCtl [data-ovstyle]').length >= 20", 'сетка стилей плейлиста')
            src0 = await pg.evaluate("document.getElementById('ovFrame').getAttribute('src')")
            ok('/overlay/playlist?preview=1' in (src0 or ''), 'превью плейлиста — настоящая страница пака')

            def wait_cfg(key, val, label):
                return wait_state(lambda s: (s.get('cfg') or {}).get(key) == val, label)

            await pg.click('#ovCtl [data-ovstyle=card]')
            st = wait_cfg('style', 'card', 'плейлист: стиль = card')
            ok((st['cfg'] or {}).get('color') == '#FFFFFF', 'плейлист: смена стиля поставила его цвет')
            await pg.click('#ovCtl [data-ovstyle=dos]')
            wait_cfg('style', 'dos', 'плейлист: стиль = dos')
            # Все тумблеры и отрезки «Что показывать» плейлиста (DOS — самый полный набор)
            for key in ('cover', 'time', 'spin', 'prog', 'osc', 'marq', 'fade', 'fill', 'nums'):
                before_val = (state().get('cfg') or {}).get(key)
                await pg.click('#ovCtl [data-ovt=%s]' % key)
                wait_cfg(key, not before_val, 'плейлист: %s = %s' % (key, not before_val))
            await pg.click('#ovCtl [data-ovv=lang][data-val=ru]')
            wait_cfg('lang', 'ru', 'плейлист: подписи = ru')
            await pg.evaluate("(function(){var e=document.getElementById('ovFade'); e.value='50'; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            wait_cfg('fadePct', 50, 'плейлист: затухание = 50 %')
            await pg.click('#ovCtl [data-ovt=nick]')
            wait_cfg('nick', False, 'плейлист: ник = выкл')
            await pg.click('#ovCtl [data-ovv=count][data-val="5"]')
            wait_cfg('count', 5, 'плейлист: сколько песен = 5')
            await pg.click('#ovCtl [data-ovv=viz][data-val=spectrum]')
            wait_cfg('viz', 'spectrum', 'плейлист: вид визуализатора = spectrum')
            await pg.click('#ovCtl [data-ovv=smooth][data-val=fast]')
            wait_cfg('smooth', 'fast', 'плейлист: плавность = fast')
            await pg.click('#ovCtl [data-ovc="#33FF66"]')
            wait_cfg('color', '#33FF66', 'плейлист: цвет текста = #33FF66')
            await pg.click('#ovScreen [data-ovpos=tl]')
            wait_cfg('pos', 'tl', 'плейлист: угол = tl')
            await pg.evaluate("(function(){var e=document.getElementById('ovSize'); e.value='250'; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            wait_cfg('size', 250, 'плейлист: размер = 250 %')
            ok(await pg.evaluate("document.getElementById('ovFrame').getAttribute('src')") == src0,
               'плейлист: iframe не перезагружается на изменениях')
            await pg.click('#ovScreen [data-ova=reset-pos]')
            wait_state(lambda s: (s.get('cfg') or {}).get('pos') == 'br' and (s.get('cfg') or {}).get('size') == 100,
                       'плейлист: сброс положения')
            await pg.click('#ovTop [data-ova=copy]')
            await pg.wait_for_timeout(200)
            ok(await pg.evaluate("window.__copied || ''") == 'http://localhost:%d/overlay/playlist' % port,
               'плейлист: «Скопировать» кладёт свою ссылку')

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
