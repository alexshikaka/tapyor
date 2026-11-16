# WZ3: шаги визарда — «Очередь» (волна только после входа), финал слушателя
# (одна главная кнопка по ситуации) и справка «Живая очередь» у стримера.
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8812', '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 380, 'height': 820})
        await pg.add_init_script("""
          window.__wcalls = [];
          window.wizardApi = {
            cmd: function (p) { window.__wcalls.push(p); },
            close: function () { window.__wcalls.push({ op: 'close' }); },
            onEvent: function (fn) { window.__winit = fn; }
          };
        """)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        E = pg.evaluate

        async def init(d):
            await E("window.__wcalls.length = 0")
            await E("window.__winit && window.__winit(" + d + ")")
            await pg.wait_for_timeout(120)

        async def main_text():
            return (await E("document.querySelector('.wiz-main').textContent")).strip()

        await pg.goto('http://127.0.0.1:8812/app2/wizard/index.html')
        await pg.wait_for_timeout(300)

        # ── Шаг «Очередь» ──
        await init("{type:'init',from:'debug',route:'listener',step:'queue',facts:{music:{ym:false}}}")
        ok(await E("document.getElementById('wizTitle').textContent") == 'Твой плейлист уже играет', 'заголовок шага очереди')
        ok(await E("document.querySelectorAll('.wiz-qcard').length") == 3, 'три карточки шага очереди')
        calls = await E("window.__wcalls")
        ok(any(c.get('op') == 'highlight' and c.get('sel') == '.queue-col' for c in calls), 'подсвечена колонка очереди')
        ok(await E("document.getElementById('wizQueueWave').hidden === true"), 'без входа в Яндекс волны нет')
        await E("window.__winit({type:'listenerstate',ym:true,queue:0})")
        await pg.wait_for_timeout(80)
        ok(await E("document.getElementById('wizQueueWave').hidden === false"), 'вошёл в Яндекс — волна появилась')

        await init("{type:'init',from:'debug',route:'listener',step:'queue',facts:{music:{ym:true}}}")
        ok(await E("document.getElementById('wizQueueWave').hidden === false"), 'волна видна сразу из фактов')

        # ── Финал слушателя: одна главная кнопка ──
        await init("{type:'init',from:'debug',route:'listener',step:'listener-final',facts:{music:{ym:true}}}")
        ok(await main_text() == '▶ Включить Мою волну', 'вошёл в Яндекс — «Мою волну»')
        ok(await E("document.querySelectorAll('.wiz-main').length") == 1, 'главная кнопка одна')
        await pg.click('.wiz-main')
        await pg.wait_for_timeout(120)
        calls = await E("window.__wcalls")
        ok(any(c.get('op') == 'tab' and c.get('tab') == 'wave' for c in calls), '«Моя волна» ведёт на «Волну»')
        ok(any(c.get('op') == 'bg' for c in calls), '«Моя волна» включает фон')
        ok(any(c.get('op') == 'close' for c in calls), 'финал закрывает визард')

        await init("{type:'init',from:'debug',route:'listener',step:'listener-final',facts:{music:{ym:false},demo:true}}")
        ok(await main_text() == '▶ Включить мой плейлист', 'собрал демо-плейлист — «мой плейлист»')
        await pg.click('.wiz-main')
        await pg.wait_for_timeout(120)
        calls = await E("window.__wcalls")
        ok(any(c.get('op') == 'tab' and c.get('tab') == 'my' for c in calls), '«мой плейлист» ведёт на «Плейлисты»')

        await init("{type:'init',from:'debug',route:'listener',step:'listener-final',facts:{music:{ym:false}}}")
        ok(await main_text() == 'Найти песню', 'иначе — «Найти песню»')
        await pg.click('.wiz-main')
        await pg.wait_for_timeout(120)
        calls = await E("window.__wcalls")
        ok(any(c.get('op') == 'tab' and c.get('tab') == 'search' for c in calls), '«Найти песню» ведёт на «Поиск»')

        # Очередь сообщает главное окно: демо-плейлист уже в очереди
        await init("{type:'init',from:'debug',route:'listener',step:'listener-final',facts:{music:{ym:false}}}")
        await E("window.__winit({type:'listenerstate',ym:false,queue:2})")
        await pg.wait_for_timeout(80)
        ok(await main_text() == '▶ Включить мой плейлист', 'очередь не пуста — «мой плейлист»')

        # Факты приходят позже init — финал перерисовывается
        await init("{type:'init',from:'debug',route:'listener',step:'listener-final',facts:null}")
        ok(await main_text() == 'Найти песню', 'без фактов — «Найти песню»')
        await E("window.__winit({type:'facts',facts:{music:{ym:true}}})")
        await pg.wait_for_timeout(80)
        ok(await main_text() == '▶ Включить Мою волну', 'факты дошли позже — кнопка обновилась')

        # ── Справка «Живая очередь» — шаг стримера ──
        await init("{type:'init',from:'debug',route:'streamer',step:'livehelp',facts:null}")
        calls = await E("window.__wcalls")
        ok(any(c.get('op') == 'do' and c.get('name') == 'openLiveHelp' and (c.get('args') or {}).get('anchor') is True for c in calls), 'шаг открывает справку у очереди в главном окне')
        ok({'op': 'highlight', 'tab': 'search', 'sel': '#qMode'} in calls, 'и подсвечивает переключатель режима очереди')
        ok(await E("document.getElementById('wizTitle').textContent") == 'Два режима плейлиста', 'заголовок шага справки')
        await E("window.__winit({type:'livehelp',closed:true})")
        await pg.wait_for_timeout(120)
        ok(await E("document.getElementById('wizTitle').textContent") == 'Что есть для OBS', 'закрыли справку — шаг засчитан, дальше OBS')
        calls = await E("window.__wcalls")
        ok(any(c.get('op') == 'do' and c.get('name') == 'closeLiveHelp' for c in calls), 'со шага справка закрывается')

        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
