# OVC2, пункты 4–5: «Что показывать» и визуализатор по возможностям стиля,
# нейтральные формулировки, старый пак без ошибок.
#  - у стиля без spin нет «Курсор-вертушки», у DOS — есть;
#  - у стиля без vizKind нет ни раздела «Визуализатор», ни «Цвета визуализатора»;
#  - пункты очереди — только у плейлиста, у моушна их нет никогда;
#  - смена стиля сразу перестраивает разделы;
#  - старый пак: у моушна подсказка «обнови Пак стримера», окно без ошибок.
import os, sys, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8834

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
        feat = "['cover','prog','marq']"          # ни времени, ни визуализатора, ни подписей, ни очереди
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
    window.__ov.cmds.push(arg === undefined ? cmd : [arg]);
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

async def open_overlay(b, script, pane='sOverlay'):
    pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
    await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
    await pg.add_init_script(script)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
    await pg.wait_for_timeout(700)
    await pg.evaluate("setTab('settings'); showSettingsPane('%s'); ovLoad();" % pane)
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

            # ── DOS: все пункты, очередь и визуализатор на месте ────────────
            ok(await E("!!document.querySelector('#ovCtl [data-ovt=spin]')"), 'DOS: пункт «Курсор-вертушка» есть')
            ok('Курсор-вертушка' in await E("document.getElementById('ovCtl').innerText"), 'DOS: подпись вертушки видна')
            ok(await E("!!document.querySelector('#ovCtl [data-ovt=osc]')"), 'DOS: пункт «Визуализатор» есть')
            ok(await E("!!document.querySelector('#ovCtl [data-ovv=viz]')"), 'DOS: «Вид визуализатора» есть (вид переключается)')
            ok(await E("!!document.querySelector('#ovCtl [data-ovvc]')"), 'DOS: «Цвет визуализатора» есть')
            ok(await E("!!document.querySelector('#ovCtl [data-ovv=lang]')"), 'DOS: «Подписи» есть')
            ok(await E("!!document.querySelector('#ovCtl [data-ovv=count]')"), 'DOS: раздел «Список» (очередь) есть')

            # ── Стиль без спина и визуализатора ────────────────────────────
            await pg.click('#ovCtl .ov-style[data-ovstyle=code]')
            await pg.wait_for_timeout(500)
            t = await E("document.getElementById('ovCtl').innerText")
            ok(not await E("!!document.querySelector('#ovCtl [data-ovt=spin]')"), 'стиль без spin: пункта «Курсор-вертушка» нет')
            ok('Курсор-вертушка' not in t, 'стиль без spin: подписи вертушки нет')
            ok(not await E("!!document.querySelector('#ovCtl [data-ovt=time]')"), 'стиль без time: пункта «Время» нет')
            ok(not await E("!!document.querySelector('#ovCtl [data-ovv=lang]')"), 'стиль без lang: «Подписей» нет')
            ok(not await E("!!document.querySelector('#ovCtl [data-ovt=osc]')"), 'стиль без vizKind: пункта визуализатора нет')
            ok(not await E("!!document.querySelector('#ovCtl [data-ovvc]')"), 'стиль без vizKind: цвета визуализатора нет')
            ok(await E("!document.querySelector('#ovCtl [data-ovv=viz]')"), 'стиль без vizKind: «Вида визуализатора» нет')
            ok('Визуализатор' not in t, 'стиль без vizKind: раздела «Визуализатор» нет')
            ok(not await E("!!document.querySelector('#ovCtl [data-ovv=count]')"), 'стиль без ключей очереди: раздела «Список» нет')
            ok('Сколько песен показывать' not in t, 'стиль без очереди: пункта «Сколько песен» нет')
            ok(await E("!!document.querySelector('#ovCtl [data-ovt=cover]')") and
               await E("!!document.querySelector('#ovCtl [data-ovt=prog]')") and
               await E("!!document.querySelector('#ovCtl [data-ovt=marq]')"),
               'стиль без spin: его собственные пункты (обложка, шкала, бегущая строка) остались')
            ok(await E("!!document.querySelector('#ovCtl [data-ovt=nick]')"), 'ник заказавшего есть у любого стиля')

            # Смена стиля сразу возвращает пункты DOS
            await pg.click('#ovCtl .ov-style[data-ovstyle=dos]')
            await pg.wait_for_timeout(500)
            ok(await E("!!document.querySelector('#ovCtl [data-ovt=spin]')"), 'смена стиля на DOS сразу вернула вертушку')
            ok(await E("!!document.querySelector('#ovCtl [data-ovv=viz]')"), 'смена стиля на DOS сразу вернула вид визуализатора')

            # ── Моушн: свой стиль, без очереди ──────────────────────────────
            await pg.evaluate("showSettingsPane('sMotion')")
            await pg.wait_for_timeout(800)
            mt = await E("document.getElementById('motionPanel').innerText")
            ok(await E("!!document.querySelector('#motionPanel [data-ovmt=spin]')"), 'моушн DOS: «Курсор-вертушка» есть')
            ok(await E("!!document.querySelector('#motionPanel [data-ovmvc]')"), 'моушн DOS: «Цвет визуализатора» есть')
            for word in ('Сколько песен показывать', 'Затухание строк', 'Добирать из волны', 'Номера строк', 'Список'):
                ok(word not in mt, 'у моушна нет пункта «%s»' % word)
            ok(not await E("!!document.querySelector('#motionPanel [data-ovv=count], #motionPanel [data-ovv=fade]')"),
               'у моушна нет кнопок очереди')

            await pg.click('#motionPanel [data-ovmstyle=code]')
            await pg.wait_for_timeout(500)
            mt = await E("document.getElementById('motionPanel').innerText")
            ok(not await E("!!document.querySelector('#motionPanel [data-ovmt=spin]')"), 'моушн без spin: вертушки нет')
            ok(not await E("!!document.querySelector('#motionPanel [data-ovmt=time]')"), 'моушн без time: пункта «Время» нет')
            ok(not await E("!!document.querySelector('#motionPanel [data-ovmvc]')"), 'моушн без vizKind: цвета визуализатора нет')
            ok('Визуализатор' not in mt, 'моушн без vizKind: раздела «Визуализатор» нет')
            ok('Курсор-вертушка' not in mt, 'моушн без spin: подписи вертушки нет')

            # ── Формулировки ────────────────────────────────────────────────
            alltext = (await E("document.getElementById('ovPanel').innerText")) + '\n' + \
                      (await E("document.getElementById('motionPanel').innerText"))
            low = alltext.lower()
            ok('Пиксельная тень' not in alltext, 'нет «Пиксельной тени» — описание нейтральное')
            ok('тень вокруг букв и блоков' in low, 'обводка описана нейтрально: тень вокруг букв и блоков')
            ok('Осциллограмма' not in alltext, 'нет слова «Осциллограмма» — теперь «Визуализатор»')
            ok('Визуализатор' in alltext, 'слово «Визуализатор» используется')
            print('ошибки (новый пак):', errs)
            ok(not errs, 'новый пак: без ошибок страницы')
            await pg.close()

            # ── Старый пак: моушна нет, подсказка об обновлении ────────────
            pg, errs = await open_overlay(b, OLD_PACK, 'sMotion')
            mt = await pg.evaluate("document.getElementById('motionPanel').innerText")
            ok('обнови Пак стримера' in mt, 'старый пак: подсказка «обнови Пак стримера»')
            ok(not await pg.evaluate("!!document.getElementById('ovMTop')"), 'старый пак: настроек моушна нет')
            ok(await pg.evaluate("document.querySelectorAll('#motionPanel [data-ovmstyle]').length") == 0,
               'старый пак: сетки стилей моушна нет')
            await pg.evaluate("showSettingsPane('sOverlay')")
            await pg.wait_for_timeout(600)
            n = await pg.evaluate("document.querySelectorAll('#ovCtl .ov-style').length")
            ok(n == 2, 'старый пак: 2 стиля, как раньше (нарисовано: %d)' % n)
            ok(await pg.evaluate("!!document.querySelector('#ovCtl [data-ovt=spin]')"),
               'старый пак: неизвестные возможности — показываем всё, как раньше')
            ok('Моушн-оверлей' not in await pg.evaluate("document.getElementById('ovPanel').innerText"),
               'старый пак: в плейлисте слов про моушн нет')
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
