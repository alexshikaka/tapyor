# OVC, Я1: ник заказавшего в снимке плеера для оверлея (src/ui/25-overlay.js).
#  - заказ с ником → who у np и у строк next; смена ника без смены трека уходит странице (sig);
#  - «Аноним», пусто и трек из волны (after) → поля who нет; суммы/валюты не отдаются;
#  - ник обрезается пробелами и до 40 знаков.
import os, sys, json, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8831

# Пак не установлен: окно настроек оверлея не грузим, проверяем только снимок.
MOCK = r"""
(function(){
  var P = function(v){ return new Promise(function(r){ setTimeout(function(){ r(v); }, 10); }); };
  window.app.modStatus = function(){ return P({ installed:false, running:false, manifest:null, dev:false, prev:null,
    license:{ enabled:false, state:'not-installed' }, modules:{}, error:null }); };
  window.app.onModStatus = function(){};
})();
"""

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=HERE,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
            pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
            await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
            await pg.add_init_script(MOCK)
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
            await pg.wait_for_timeout(800)
            E = pg.evaluate

            # 1. Заказ с ником: пробелы убраны, поле who есть.
            o = json.loads(await E("JSON.stringify(ovTrack({ title:'Кукушка', author:'Кино', req:{ who:'  Димон   Плей  ' } }))"))
            ok(o.get('title') == 'Кукушка' and o.get('who') == 'Димон Плей', 'заказ с ником: who в снимке трека')

            # 1a. Длинный ник — до 40 знаков.
            o = json.loads(await E("JSON.stringify(ovTrack({ title:'T', req:{ who:'%s' } }))" % ('я' * 50)))
            ok(len(o.get('who', '')) == 40, 'ник обрезан до 40 знаков')

            # 2. «Аноним», пусто, пробелы и трек без заказа — поля who нет.
            for expr, name in [
                ("ovTrack({ title:'T', req:{ who:'Аноним' } })", 'донат «Аноним»'),
                ("ovTrack({ title:'T', req:{ who:'   ' } })", 'пустой ник'),
                ("ovTrack({ title:'T' })", 'трек без заказа (волна/свой)'),
            ]:
                o = json.loads(await E('JSON.stringify(' + expr + ')'))
                ok('who' not in o, name + ' → поля who нет')

            # 3. Очередь: у каждой строки next свой who, аноним — без поля.
            n = json.loads(await E("""(function(){
              queue = [{ src:'ym', id:'1', title:'A' },
                       { src:'ym', id:'2', title:'B', req:{ who:'Ник2' } },
                       { src:'ym', id:'3', title:'C', req:{ who:'Аноним' } }];
              current = 0;
              return JSON.stringify(ovNextList());
            })()"""))
            ok(n[0].get('who') == 'Ник2', 'следующий заказ с ником: who есть')
            ok('who' not in n[1], 'следующий «Аноним»: who нет')

            # 4. Волна (after) — ника нет, даже если у трека есть req.who.
            a = json.loads(await E("""(function(){
              bgOn = true;
              bgPreview = function(){ return [{ src:'ym', id:'9', title:'Волна', req:{ who:'НикВолны' } }]; };
              return JSON.stringify(ovAfterList());
            })()"""))
            ok(len(a) == 1 and 'who' not in a[0], 'трек из волны (after) → who нет')

            # 5. Снимок np: who попадает; после смены заказчика без смены трека ovFeed шлёт снова.
            r = await E("""(function(){
              window.__feeds = [];
              ovSent = ''; OVW.state = true;
              A.modPlayer = function(s){ window.__feeds.push(s); };
              queue = [{ src:'ym', id:'51', title:'Трек', author:'Артист', seconds:100, req:{ who:'Первый' } }];
              current = 0;
              mode = 'audio'; loadingIdx = -1; aud.src = '/loud.wav';
              var first = ovSnap();
              ovFeed(true);
              queue[0].req.who = 'Второй';
              ovFeed(false);
              return JSON.stringify({ first: first, feeds: window.__feeds });
            })()""")
            r = json.loads(r)
            ok(r['first']['np'].get('who') == 'Первый', 'np: who заказчика в снимке')
            ok(len(r['feeds']) == 2, 'смена заказчика без смены трека — снимок отправлен ещё раз')
            ok(r['feeds'][-1]['np'].get('who') == 'Второй', 'в повторном снимке новый ник')

            print('ошибки:', errs)
            ok(not errs, 'без ошибок страницы')
            await b.close()
    finally:
        srv.terminate()

try:
    asyncio.run(main())
except SystemExit:
    raise
