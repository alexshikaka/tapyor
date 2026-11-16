# OVC, Я2: окно «Модули → Оверлей» берёт стили у модуля (src/ui/25-overlay.js).
#  - новый пак: 26 карточек «№ · название», нажатая — .on, выбор шлёт save({style,color,vizColor});
#  - моушн — отдельная вкладка: свои стиль/угол/сценарий/ник/цвета, ссылка и «Показать сейчас»;
#  - старый пак (команда styles бросает ошибку): 2 стиля, как раньше, у моушна подсказка об обновлении,
#    без ошибок страницы.
import os, sys, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8832

# 26 стилей — как их будет отдавать модуль (порядок и номера макета).
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
STYLES_JS = ', '.join(
    "{id:'%s',num:%d,name:'%s',font:'%s',color:'#112233',vizColor:'#445566'}" % s for s in STYLES)

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

OLD_PACK = r"""
(function(){
  var A = window.app; var P = function(v){ return new Promise(function(r){ setTimeout(function(){ r(v); }, 10); }); };
  var CFG = { style:'dos', pos:'br', dx:0, dy:0, size:100, color:'#FFB000', vizColor:'#FFB000', outline:true,
    count:3, fade:true, fadePct:100, fill:true, nums:true, cover:true, time:true, spin:true, osc:true,
    prog:true, marq:true, lang:'en', viz:'wave', smooth:'mid' };
  window.__ov = { saved: [], cmds: [], cfg: CFG };
  A.modStatus = function(){ return P({ installed:true, running:true, error:null,
    manifest:{ id:'streamer-pack', version:'0.2.0', minCore:'0.32.0', modules:[{ id:'overlay', name:'Оверлей-плейлист' }] },
    dev:false, prev:null, server:false, keyMask:'',
    license:{ enabled:true, state:'full' }, modules:{ overlay:{ name:'Оверлей-плейлист', running:true, error:null } } }); };
  A.onModStatus = function(){};
  A.modCmd = function(mod, cmd, arg){
    window.__ov.cmds.push(arg === undefined ? cmd : [cmd, arg]);
    if (mod !== 'overlay') return P({});
    if (cmd === 'settings') return P(JSON.parse(JSON.stringify(CFG)));
    if (cmd === 'status') return P({ obs:0, clients:1, url:'http://127.0.0.1:47654/overlay/playlist' });
    if (cmd === 'styles') return Promise.reject(new Error('неизвестная команда оверлея: styles'));
    if (cmd === 'save') {
      Object.keys(arg || {}).forEach(function(k){ CFG[k] = arg[k]; });
      window.__ov.saved.push(JSON.parse(JSON.stringify(arg)));
      return P(JSON.parse(JSON.stringify(CFG)));
    }
    return P({});
  };
  A.onModPlayerWant = function(){};
  A.modPlayer = function(){};
})();
"""

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
    await pg.wait_for_timeout(500)
    return pg, errs

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=HERE,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))

            # ── Новый пак: 26 стилей от модуля ──────────────────────────────
            pg, errs = await open_overlay(b, NEW_PACK)
            E = pg.evaluate
            n = await E("document.querySelectorAll('#ovCtl .ov-style').length")
            ok(n == 26, '26 карточек стилей из команды styles (нарисовано: %d)' % n)
            ok(await E("['about:blank', null].indexOf(document.getElementById('ovMFrame').getAttribute('src')) >= 0"),
               'превью моушна не грузится, пока раздел не виден')
            labels = await E("Array.from(document.querySelectorAll('#ovCtl .ov-style')).map(b=>b.textContent.trim())")
            ok(any(x.startswith('12 · DOS-терминал') for x in labels), 'номер и название: «12 · DOS-терминал»')
            ok(labels[-1].startswith('27 · Радар HUD'), 'порядок как у модуля: последний — «27 · Радар HUD»')
            ok(await E("document.querySelector('#ovCtl .ov-style.on').dataset.ovstyle") == 'dos', 'текущий стиль нажат (.on)')
            ok(await E("document.querySelectorAll('#ovCtl .ov-style:disabled').length") == 0, '«позже»-карточек нет')

            await pg.click('#ovCtl .ov-style[data-ovstyle=vinyl]')
            await pg.wait_for_timeout(400)
            saved = await E("window.__ov.saved[window.__ov.saved.length-1]")
            ok(saved.get('style') == 'vinyl' and saved.get('color') == '#112233' and saved.get('vizColor') == '#445566',
               'выбор стиля шлёт save({style,color,vizColor}) цвета стиля')
            ok(await E("document.querySelector('#ovCtl .ov-style.on').dataset.ovstyle") == 'vinyl', 'новый стиль отмечен')

            # ── Ник в «Что показывать» ──────────────────────────────────────
            ok(await E("!!document.querySelector('#ovCtl [data-ovt=nick]')"), 'есть тумблер «Показать ник заказавшего»')
            ok('Суммы не показываются' in await E("document.getElementById('ovCtl').innerText"), 'описание: суммы не показываются')
            ok(await E("document.querySelector('#ovCtl [data-ovt=nick]').classList.contains('on')"), 'ник включён по настройке')
            await pg.click('#ovCtl [data-ovt=nick]'); await pg.wait_for_timeout(350)
            last = await E("window.__ov.saved[window.__ov.saved.length-1]")
            ok(last.get('nick') is False, 'тумблер ника сохраняется в nick')

            # ── Отдельная вкладка «Моушн-оверлей» ──────────────────────────
            await pg.evaluate("showSettingsPane('sMotion')")
            await pg.wait_for_timeout(700)
            ok(await E("document.querySelector('#sMotion .sec-h h2').textContent.trim()") == 'Моушн-оверлей',
               'своя вкладка «Моушн-оверлей»')
            mt = await E("document.getElementById('motionPanel').innerText")
            ok('при смене трека' in mt and 'очереди нет' in mt, 'пояснение про смену трека и отсутствие очереди')
            n = await E("document.querySelectorAll('#motionPanel .ov-style').length")
            ok(n == 26, 'моушн: та же сетка из 26 стилей (нарисовано: %d)' % n)
            ok(await E("document.querySelector('#motionPanel .ov-style.on').dataset.ovmstyle") == 'dos', 'моушн: текущий стиль нажат')
            ok('OBS видит · 1' in mt, 'моушн: плашка «OBS видит · 1»')

            await pg.click('#motionPanel [data-ovmstyle=card]'); await pg.wait_for_timeout(350)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('style') == 'card' and m.get('color') == '#112233' and m.get('vizColor') == '#445566',
               'моушн: выбор стиля шлёт motion.style + цвета стиля')
            ok(m.get('pos') == 'bc' and m.get('hold') == 5, 'моушн: остальные поля объекта motion сохранены')

            await pg.click('#motionPanel [data-ovmpos=tl]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('pos') == 'tl', 'моушн: угол сохраняется в motion.pos')

            await pg.click('#motionPanel [data-ovmscene=scene][data-val=mask]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('scene') == 'mask', 'моушн: сценарий «Маска и штрих» → motion.scene=mask')

            await E("(function(){var e=document.getElementById('ovMHold'); e.value=9; e.dispatchEvent(new Event('input',{bubbles:true}));})()")
            await pg.wait_for_timeout(500)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('hold') == 9, 'моушн: ползунок «Сколько держать» → motion.hold=9')
            ok('9 с' in await E("document.getElementById('ovMHoldT').textContent"), 'пояснение показывает новое время')

            await pg.click('#motionPanel [data-ovmt=nick]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('nick') is False, 'моушн: тумблер ника → motion.nick')

            await pg.click('#motionPanel [data-ovmc="#33FF66"]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('color') == '#33FF66', 'моушн: цвет текста → motion.color')
            await pg.click('#motionPanel [data-ovmvc="#4FD8FF"]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('vizColor') == '#4FD8FF', 'моушн: цвет визуализатора → motion.vizColor')

            # Переключатели-отрезки моушна (не тумблеры!)
            await pg.click('#motionPanel [data-ovmv=lang][data-val=ru]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('lang') == 'ru', 'моушн: «Подписи → ТРЕК / АРТИСТ» пишет motion.lang=ru')
            await pg.click('#motionPanel [data-ovmv=smooth][data-val=slow]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('smooth') == 'slow', 'моушн: «Плавность → Плавно» пишет motion.smooth=slow')
            await pg.click('#motionPanel [data-ovmv=viz][data-val=spectrum]'); await pg.wait_for_timeout(300)
            m = (await E("window.__ov.saved[window.__ov.saved.length-1]")).get('motion', {})
            ok(m.get('viz') == 'spectrum', 'моушн: «Вид визуализатора → Спектр» пишет motion.viz=spectrum')

            await pg.click('#motionPanel [data-ova=copy-motion]'); await pg.wait_for_timeout(250)
            ok(await E("window.__ov.copied") == 'http://127.0.0.1:47654/overlay/motion', 'моушн: «Скопировать» кладёт свою ссылку')
            await pg.click('#motionPanel [data-ova=preview-motion]'); await pg.wait_for_timeout(250)
            ok('preview-motion' in await E("window.__ov.cmds"), 'моушн: «Показать сейчас» шлёт preview-motion')

            src = await E("document.getElementById('ovMFrame').getAttribute('src')")
            ok(bool(src) and '/overlay/motion?preview=1' in src, 'превью моушна — iframe /overlay/motion?preview=1, когда вкладка видна')

            print('ошибки (новый пак):', errs)
            ok(not errs, 'новый пак: без ошибок страницы')
            await pg.close()

            # ── Старый пак: команды styles нет ──────────────────────────────
            pg, errs = await open_overlay(b, OLD_PACK)
            n = await pg.evaluate("document.querySelectorAll('#ovCtl .ov-style').length")
            ok(n == 2, 'старый пак: 2 стиля, как раньше (нарисовано: %d)' % n)
            labels = await pg.evaluate("Array.from(document.querySelectorAll('#ovCtl .ov-style')).map(b=>b.textContent.trim())")
            ok(labels[0].startswith('DOS-терминал') and labels[1].startswith('Типографика'), 'старый пак: DOS-терминал и Типографика')
            ok(await pg.evaluate("!document.getElementById('ovMFrame')"), 'старый пак: превью моушна не создаётся')
            await pg.evaluate("showSettingsPane('sMotion')")
            await pg.wait_for_timeout(500)
            mt = await pg.evaluate("document.getElementById('motionPanel').innerText")
            ok('обнови Пак стримера' in mt, 'старый пак: подсказка об обновлении пака')
            ok(await pg.evaluate("document.querySelectorAll('#motionPanel .ov-style').length") == 0, 'старый пак: сетки стилей моушна нет')
            ok(await pg.evaluate("!document.querySelector('#ovCtl [data-ovt=nick]')"), 'старый пак: тумблера ника нет')
            ok('Моушн-оверлей' not in await pg.evaluate("document.getElementById('ovPanel').innerText"), 'старый пак: слова про моушн в плейлисте нет')
            await pg.evaluate("showSettingsPane('sOverlay')")
            await pg.wait_for_timeout(400)
            await pg.click('#ovCtl .ov-style[data-ovstyle=typography]')
            await pg.wait_for_timeout(400)
            saved = await pg.evaluate("window.__ov.saved[window.__ov.saved.length-1]")
            ok(saved.get('style') == 'typography' and 'color' not in saved and 'vizColor' not in saved,
               'старый пак: выбор стиля шлёт только style')
            print('ошибки (старый пак):', errs)
            ok(not errs, 'старый пак: без ошибок страницы')
            await pg.close()
            await b.close()
    finally:
        srv.terminate()

try:
    asyncio.run(main())
except SystemExit:
    raise
