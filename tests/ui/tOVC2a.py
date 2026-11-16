# OVC2, пункты 1–3: две вкладки, без телефонов, экран + положение одним блоком.
#  - пункт меню «Моушн-оверлей» и свой раздел/панель; из плейлиста моушн убран;
#  - переключателя «монитор/телефон» и предупреждения про телефон нет;
#  - превью монитора с безопасной зоной; ползунок размера 80–250, шаг 5;
#  - колонка положения справа от экрана в широком окне и под ним в узком;
#  - блок прилипает к верху (position: sticky);
#  - у моушна своя ссылка, своя плашка OBS, своё превью и кнопка «Показать сейчас».
import os, sys, json, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8833

# Полный список стилей, как его отдаёт модуль после OV3: у DOS есть вертушка и лента,
# у «Кода» нет ни вертушки, ни подписей, ни визуализатора.
STYLES = [
    ('card', 1, 'Карточка', 'Manrope'), ('vinyl', 2, 'Винил', 'Lora'),
    ('bigtype', 3, 'Крупный шрифт', 'Unbounded'), ('column', 4, 'Колонка', 'Tektur'),
    ('typography', 5, 'Типографика', 'Manrope'), ('tilt', 6, 'Наклонённая обложка', 'Manrope'),
    ('ribbon', 7, 'Нижняя лента', 'Fira Sans Condensed'), ('vtitle', 8, 'Вертикальный заголовок', 'Oswald'),
    ('win95', 9, 'Windows 95', 'Pixelify Sans'), ('sys7', 10, 'Mac System 7', 'Pixelify Sans'),
    ('winamp', 11, 'Winamp', 'Pixelify Sans'), ('dos', 12, 'DOS-терминал', 'Pixelify Sans'),
    ('swiss', 13, 'Швейцарский стиль', 'Golos Text'), ('hud8', 14, '8-бит HUD', 'Tiny5'),
    ('synth', 15, 'Синтвейв', 'Russo One'), ('paper', 16, 'Газета', 'Playfair Display'),
    ('polaroid', 17, 'Полароид', 'Caveat'), ('code', 18, 'Код (JSON)', 'JetBrains Mono'),
    ('cassette', 19, 'Кассета', 'PT Mono'), ('vu', 20, 'VU-метр', 'IBM Plex Mono'),
    ('neon', 21, 'Неоновая вывеска', 'Pacifico'), ('film', 22, 'Киноплёнка', 'Oswald'),
    ('citypop', 23, 'Сити-поп', 'Noto Serif JP'), ('popart', 25, 'Поп-арт комикс', 'Dela Gothic One'),
    ('blueprint', 26, 'Чертёж', 'IBM Plex Mono'), ('radar', 27, 'Радар HUD', 'Tektur'),
]

def style_js(s):
    sid, num, name, font = s
    if sid == 'dos':
        feat = "['cover','time','spin','prog','osc','marq','lang','count','fade','fill','nums']"
        kind = "'level'"
    elif sid == 'code':
        feat = "['cover','prog','marq']"
        kind = "null"
    else:
        feat = "['cover','time','prog','osc','marq','lang','count','fade','fill','nums']"
        kind = "'spectrum'"
    return "{id:'%s',num:%d,name:'%s',font:'%s',color:'#112233',vizColor:'#445566',features:%s,vizKind:%s}" % (
        sid, num, name, font, feat, kind)

STYLES_JS = ', '.join(style_js(s) for s in STYLES)

NEW_PACK = r"""
(function(){
  var A = window.app; var P = function(v){ return new Promise(function(r){ setTimeout(function(){ r(v); }, 10); }); };
  var STYLES = [%s];
  var CFG = { style:'dos', pos:'br', dx:0, dy:0, size:100, color:'#FFB000', vizColor:'#FFB000', outline:true,
    nick:true, count:3, fade:true, fadePct:100, fill:true, nums:true, cover:true, time:true, spin:true, osc:true,
    prog:true, marq:true, lang:'en', viz:'wave', smooth:'mid',
    motion:{ style:'dos', pos:'bc', dx:0, dy:0, size:100, color:'#FFFFFF', vizColor:'#C8F542', outline:true,
      nick:true, scene:'brand', hold:5, cover:true, time:true, spin:true, prog:true, osc:true, marq:true, lang:'en', viz:'wave', smooth:'mid' } };
  window.__ov = { saved: [], cmds: [], copied: '', cfg: CFG, styles: STYLES };
  A.modStatus = function(){ return P({ installed:true, running:true, error:null,
    manifest:{ id:'streamer-pack', version:'0.3.0', minCore:'0.47.0', modules:[{ id:'overlay', name:'Оверлей-плейлист' }] },
    dev:false, prev:null, server:false, keyMask:'',
    license:{ enabled:true, state:'full' }, modules:{ overlay:{ name:'Оверлей-плейлист', running:true, error:null } } }); };
  A.onModStatus = function(){};
  A.modCmd = function(mod, cmd, arg){
    window.__ov.cmds.push(arg === undefined ? cmd : [cmd, arg]);
    if (mod !== 'overlay') return P({});
    if (cmd === 'settings') return P(JSON.parse(JSON.stringify(CFG)));
    if (cmd === 'status') return P({ obs:1, clients:2, url:'http://127.0.0.1:47654/overlay/playlist',
      motionUrl:'http://127.0.0.1:47654/overlay/motion', motionObs:1 });
    if (cmd === 'styles') return P(JSON.parse(JSON.stringify(STYLES)));
    if (cmd === 'save') {
      Object.keys(arg || {}).forEach(function(k){
        if (k === 'motion') CFG.motion = Object.assign({}, CFG.motion, arg.motion);
        else CFG[k] = arg[k];
      });
      window.__ov.saved.push(JSON.parse(JSON.stringify(arg)));
      return P(JSON.parse(JSON.stringify(CFG)));
    }
    if (cmd === 'preview-motion') return P({ ok:true });
    return P({});
  };
  A.onModPlayerWant = function(){};
  A.modPlayer = function(){};
  try { Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:function(t){
    window.__ov.copied = t; return Promise.resolve(); } } }); } catch (e) {}
})();
""" % STYLES_JS

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)

async def open_overlay(b, script):
    pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
    await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
    await pg.add_init_script(script)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
    await pg.wait_for_timeout(700)
    await pg.evaluate("setTab('settings'); showSettingsPane('sOverlay'); ovLoad();")
    await pg.wait_for_timeout(700)
    return pg, errs

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=HERE,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
            pg, errs = await open_overlay(b, NEW_PACK)
            E = pg.evaluate

            # ── Две вкладки ────────────────────────────────────────────────
            ok(await E("!!document.getElementById('goMotion')"), 'пункт меню «Моушн-оверлей» есть (goMotion)')
            ok(await E("!document.getElementById('goMotion').hidden"), 'пункт меню «Моушн-оверлей» виден')
            ok(await E("!!document.getElementById('sMotion') && !!document.getElementById('motionPanel')"),
               'раздел sMotion и панель motionPanel есть')
            ok(await E("document.getElementById('goMotion').textContent.trim().indexOf('Моушн-оверлей') === 0"),
               'подпись пункта меню — «Моушн-оверлей»')
            # Из плейлиста моушн убран
            ok(not await E("!!document.getElementById('ovMotionHost')"), 'в плейлисте нет раздела моушна (#ovMotionHost нет)')
            ok(not await E("!!document.getElementById('ovMotionPrev')"), 'в плейлисте нет превью моушна (#ovMotionPrev нет)')
            pltext = await E("document.getElementById('ovPanel').innerText")
            ok('Моушн-оверлей' not in pltext, 'в плейлисте нет слов «Моушн-оверлей»')
            ok(await E("document.querySelectorAll('#ovPanel [data-ovmstyle], #ovPanel [data-ovmt]').length === 0"),
               'в плейлисте нет кнопок настроек моушна')

            # ── Без телефонов ──────────────────────────────────────────────
            ok(not await E("!!document.querySelector('[data-ovp=view]')"), 'нет переключателя вида (монитор/телефон)')
            ok(not await E("!!document.getElementById('ovPhone')"), 'нет предупреждения про вертикальный телефон')
            both = pltext + await E("document.getElementById('motionPanel').innerText || ''")
            ok('Телефон' not in both and 'телефон' not in both, 'в текстах нет слова «телефон»')
            ok(await E("document.getElementById('ovStage').getBoundingClientRect().width") > 300,
               'превью — монитор 16:9, а не телефон')

            # ── Экран + положение одним блоком ─────────────────────────────
            ok(await E("getComputedStyle(document.getElementById('ovScreen')).position") == 'sticky',
               'блок экрана прилипает к верху при прокрутке (position: sticky)')
            ok(await E("!!document.querySelector('#ovScreen .ov-side .ov-pos')"), 'колонка положения у экрана есть')
            ok(await E("document.querySelectorAll('#ovScreen .ov-pos button').length") == 6, 'угол — сетка 3×2 из шести кнопок')
            ok(await E("document.querySelectorAll('#ovScreen .ov-size input').length") == 1, 'в колонке есть ползунок размера')
            smax = await E("document.getElementById('ovSize').max")
            smin = await E("document.getElementById('ovSize').min")
            sstep = await E("document.getElementById('ovSize').step")
            ok(smax == '250' and smin == '80' and sstep == '5', 'размер: 80–250, шаг 5 (сейчас %s–%s/%s)' % (smin, smax, sstep))
            ok(await E("!!document.querySelector('#ovScreen [data-ova=reset-pos]')"), 'кнопка «Сбросить» в колонке')

            # Колонка справа от экрана в широком окне
            box = json.loads(await E("""(function(){
              var s = document.getElementById('ovStage').getBoundingClientRect();
              var p = document.querySelector('#ovScreen .ov-side').getBoundingClientRect();
              return JSON.stringify({ s:{x:s.x,y:s.y,w:s.width,h:s.height}, p:{x:p.x,y:p.y,w:p.width,h:p.height} });
            })()"""))
            ok(box['p']['x'] >= box['s']['x'] + box['s']['w'] - 1, 'при 1440 px колонка справа от экрана')
            # Ползунок до 250 пишет size
            await E("(function(){var e=document.getElementById('ovSize'); e.value=250; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            await pg.wait_for_timeout(500)
            last = await E("window.__ov.saved[window.__ov.saved.length-1]")
            ok(last.get('size') == 250, 'ползунок до 250 сохраняет size=250')

            # Реально прилипает: прокрутили настройки — блок остался у верха, а не уехал
            await E("document.querySelector('.set-main').scrollTop = 700")
            await pg.wait_for_timeout(400)
            st = json.loads(await E("""(function(){
              var s = document.getElementById('ovScreen').getBoundingClientRect();
              var m = document.querySelector('.set-main').getBoundingClientRect();
              return JSON.stringify({ top:s.top, bottom:s.bottom, mainTop:m.top, mainBottom:m.bottom, scroll:document.querySelector('.set-main').scrollTop });
            })()"""))
            ok(st['scroll'] > 300 and st['top'] < st['mainTop'] + 80 and st['bottom'] > st['mainTop'] + 100,
               'при прокрутке блок остаётся у верха (top %.0f, верх окна %.0f, прокрутка %.0f)' % (st['top'], st['mainTop'], st['scroll']))
            await E("document.querySelector('.set-main').scrollTop = 0")
            await pg.wait_for_timeout(300)

            await pg.set_viewport_size({'width': 900, 'height': 1000})
            await pg.wait_for_timeout(500)
            box = json.loads(await E("""(function(){
              var s = document.getElementById('ovStage').getBoundingClientRect();
              var p = document.querySelector('#ovScreen .ov-side').getBoundingClientRect();
              return JSON.stringify({ s:{x:s.x,y:s.y,w:s.width,h:s.height}, p:{x:p.x,y:p.y,w:p.width,h:p.height} });
            })()"""))
            ok(box['p']['y'] >= box['s']['y'] + box['s']['h'] - 1, 'при 900 px колонка уходит под экран')
            await pg.set_viewport_size({'width': 1440, 'height': 1000})
            await pg.wait_for_timeout(400)

            # ── Превью плейлиста и моушн-вкладка ───────────────────────────
            src = await E("document.getElementById('ovFrame').getAttribute('src')")
            ok(bool(src) and '/overlay/playlist?preview=1' in src, 'превью плейлиста — iframe /overlay/playlist?preview=1')
            ok('безопасная зона' in await E("document.getElementById('ovCap').textContent"),
               'подпись про безопасную зону на месте')

            await pg.evaluate("document.getElementById('goMotion').click()")
            await pg.wait_for_timeout(900)
            ok(await E("document.getElementById('sMotion').hidden === false"), 'вкладка моушна открывается')
            ok(await E("document.getElementById('sOverlay').hidden === true"), 'вкладка плейлиста при этом скрыта')
            ok(await E("document.getElementById('ovFrame').getAttribute('src') === 'about:blank'"),
               'превью плейлиста выгружено, пока вкладка не видна')
            mtext = await E("document.getElementById('motionPanel').innerText")
            ok('http://127.0.0.1:47654/overlay/motion' in mtext, 'своя ссылка моушна для OBS')
            ok('OBS видит · 1' in mtext, 'своя плашка «OBS видит · 1»')
            ok(await E("!!document.querySelector('#motionPanel [data-ova=copy-motion]')"), 'кнопка «Скопировать» у моушна')
            ok(await E("!!document.querySelector('#motionPanel [data-ova=preview-motion]')"), 'кнопка «Показать сейчас» у моушна')
            ok(await E("getComputedStyle(document.getElementById('ovMScreen')).position") == 'sticky',
               'блок экрана моушна тоже прилипает к верху')
            ok(await E("document.getElementById('ovMSize').max") == '250', 'ползунок размера моушна до 250')
            ok(await E("document.querySelectorAll('#ovMScreen .ov-pos button').length") == 6, 'у моушна сетка угла 3×2')
            msrc = await E("document.getElementById('ovMFrame').getAttribute('src')")
            ok(bool(msrc) and '/overlay/motion?preview=1' in msrc, 'превью моушна — iframe /overlay/motion?preview=1')
            ok('безопасная зона' in await E("document.getElementById('ovMCap').textContent"),
               'у моушна подпись про безопасную зону')
            await pg.click('#motionPanel [data-ova=copy-motion]')
            await pg.wait_for_timeout(200)
            ok(await E("window.__ov.copied") == 'http://127.0.0.1:47654/overlay/motion', '«Скопировать» кладёт ссылку моушна')
            await pg.click('#motionPanel [data-ova=preview-motion]')
            await pg.wait_for_timeout(200)
            ok('preview-motion' in await E("window.__ov.cmds"), '«Показать сейчас» шлёт preview-motion')
            # ползунок моушна
            await E("(function(){var e=document.getElementById('ovMSize'); e.value=250; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            await pg.wait_for_timeout(500)
            last = await E("window.__ov.saved[window.__ov.saved.length-1]")
            ok((last.get('motion') or {}).get('size') == 250, 'ползунок моушна до 250 сохраняет motion.size=250')

            await pg.evaluate("document.getElementById('goOverlay').click()")
            await pg.wait_for_timeout(800)
            ok(await E("document.getElementById('sOverlay').hidden === false"), 'вкладка плейлиста открывается обратно')
            ok(await E("document.getElementById('sMotion').hidden === true"), 'вкладка моушна скрыта')
            ok(await E("document.getElementById('ovMFrame').getAttribute('src') === 'about:blank'"),
               'превью моушна выгружено, пока вкладка не видна')

            # Снимки для отчёта: OVC2_SHOTS=<папка>
            shots = os.environ.get('OVC2_SHOTS')
            if shots:
                os.makedirs(shots, exist_ok=True)
                await pg.set_viewport_size({'width': 1440, 'height': 3000})
                await E("var t=document.getElementById('toast'); if(t) t.hidden=true;"
                        "document.querySelector('.set-in').style.height='auto';"
                        "var m=document.querySelector('.set-main'); m.style.overflow='visible'; m.style.maxHeight='none';")
                for pane, name in (('sOverlay', 'playlist'), ('sMotion', 'motion')):
                    await E("showSettingsPane('%s')" % pane)
                    await pg.wait_for_timeout(700)
                    await E("document.querySelectorAll('.ov-sticky').forEach(function(e){ e.style.position='static'; });")
                    for theme, tname in (('dark', 'dark'), ('dark-l', 'light')):
                        await E("applyTheme('%s', false)" % theme)
                        await pg.wait_for_timeout(450)
                        el = await pg.query_selector('#' + pane)
                        if el: await el.screenshot(path=os.path.join(shots, 'ovc2-%s-%s.png' % (name, tname)))
                print('снимки:', shots)

            print('ошибки:', errs)
            ok(not errs, 'без ошибок страницы')
            await b.close()
    finally:
        srv.terminate()

try:
    asyncio.run(main())
except SystemExit:
    raise
