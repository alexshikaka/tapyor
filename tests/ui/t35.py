# 0.34.0: отладочное меню — вход, разделы, отчёт и журнал (поддельный window.app, не Тапёр)
import asyncio, os, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8795', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)


MOCK = r"""
window.app.debugState = async () => ({ ok: true, state: {
  version: '0.34.0', build: 'stable', buildText: 'стабильная', commit: 'abc1234',
  channel: 'stable', channelText: 'стабильная', license: 'полная',
  pack: 'установлен, 0.3.0', modules: { bot: true, overlay: false },
  logins: { youtube: true, yandex: false, donationalerts: true, donatepay: false, twitch: true, lastfm: false, github: true },
  autofix: { youtube: 0, yandex: 0, donationalerts: 0, donatepay: 0, twitch: 0, lastfm: 0, github: 0 },
  dataDir: 'C:/Users/Test/AppData/Roaming/Тапёр',
  load: { watch: true, current: { mem: 100, cpu: 2.5, at: Date.now() },
          peaks: { mem: 120, memAt: Date.now() - 1000, cpu: 5.2, cpuAt: Date.now() } },
  verbose: false
} });
window.app.debugPeaksReset = async () => ({ ok: true, peaks: {
  mem: 100, memAt: Date.now(), cpu: 2.5, cpuAt: Date.now(), lastMem: 100, lastCpu: 2.5, lastAt: Date.now()
} });
window.app.debugVerboseSet = async (on) => ({ ok: true, on: on === true });
window.app.debugSaveLog = async () => ({ ok: true, path: 'C:/Users/Test/AppData/Roaming/Тапёр/log.txt' });
window.app.debugSaveReport = async () => ({ ok: true, path: 'C:/Users/Test/AppData/Roaming/Тапёр/report.txt', bytes: 1234 });
window.app.debugReveal = async () => true;
"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(MOCK)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8795/app2/index.html')
        await pg.wait_for_timeout(800)
        E = pg.evaluate
        vis = lambda sel: E(f"(()=>{{var e=document.querySelector('{sel}'); return !!e && e.offsetParent!==null}})()")

        # 1. Вход «tapyor debug»: регистр и лишние пробелы, поле очищается, меню открылось.
        await pg.fill('#search', '  Tapyor   Debug  ')
        await pg.press('#search', 'Enter')
        await pg.wait_for_timeout(500)
        ok(await vis('#sDebug'), 'отладочный раздел открылся')
        ok(await vis('#goDebug'), 'пункт «Отладка» появился в левом меню')
        ok(await E("document.body.dataset.tab") == 'settings', 'перешли в настройки')
        ok(await E("document.getElementById('search').value") == '', 'поле поиска очищено')
        line = await E("(document.querySelector('#sDebug .disc')||{}).innerText || ''")
        ok('Отладочное меню.' in line and 'каждое опасное действие переспросит' in line, 'строка про отладку на месте')
        ok(await E("Array.from(document.querySelectorAll('#dbgNav [data-dbg-tab]')).map(b=>b.dataset.dbgTab).join(',')") == 'state,load,log,resets,fault,crashes,testorder,report', 'разделы меню на месте')
        top = await E("(document.getElementById('dbgTop')||{}).innerText || ''")
        ok('Тестовый профиль' in top and 'Перезапустить в тестовом профиле' in top, 'первая карточка — тестовый профиль')

        # 2. «Состояние»: версия, лицензия, входы только словами.
        st = await E("document.getElementById('dbgBody').innerText")
        ok('0.34.0' in st and 'стабильная' in st and 'полная' in st, 'состояние: версия, сборка, лицензия')
        ok('YouTube' in st and 'есть' in st and 'нет' in st, 'входы: есть/нет')
        ok('C:/Users/Test' in st, 'путь папки данных показан')

        # 3. «Нагрузка»: текущие цифры и пики, сброс.
        await pg.click('#dbgNav [data-dbg-tab=load]')
        await pg.wait_for_timeout(200)
        load = await E("document.getElementById('dbgBody').innerText")
        ok('100 МБ' in load and '2,5' in load, 'нагрузка: текущие память и ЦП')
        ok('120 МБ' in load and '5,2' in load, 'нагрузка: пики памяти и ЦП')
        await pg.click('[data-dbg-act=reset-peaks]')
        await pg.wait_for_timeout(250)
        load2 = await E("document.getElementById('dbgBody').innerText")
        ok('100 МБ' in load2 and '120 МБ' not in load2, 'сброс пиков: новый пик = текущий замер')

        # 3б. Вход на вкладку «Нагрузка» перечитывает состояние: выключенный в настройках замер
        # виден сразу, без кнопки «Обновить» (живая ошибка 11.11, исправление 26b2262).
        await pg.evaluate("""() => {
          const old = window.app.debugState;
          window.app.debugState = async () => {
            const r = await old();
            r.state.load.watch = false;
            return r;
          };
        }""")
        await pg.click('#dbgNav [data-dbg-tab=state]')
        await pg.wait_for_timeout(300)
        await pg.click('#dbgNav [data-dbg-tab=load]')
        await pg.wait_for_timeout(500)
        loadoff = await E("document.getElementById('dbgBody').innerText")
        ok('Замер выключен в настройках' in loadoff and 'Включить' in loadoff, 'нагрузка: выключенный замер виден без «Обновить»')

        # 4. «Журнал»: подробный журнал и сохранение.
        await pg.click('#dbgNav [data-dbg-tab=log]')
        await pg.wait_for_timeout(200)
        await pg.click('[data-dbg-act=verbose]')
        await pg.wait_for_timeout(200)
        ok(await E("document.querySelector('[data-dbg-act=verbose]').classList.contains('on')"), 'подробный журнал включился')
        await pg.click('[data-dbg-act=save-log]')
        await pg.wait_for_timeout(300)
        logtxt = await E("document.getElementById('dbgBody').innerText")
        ok('Журнал сохранён' in logtxt and 'Открыть папку' in logtxt, 'журнал сохранён, есть «Открыть папку»')

        # 5. «Собрать отчёт»: сохранение и открытие папки.
        await pg.click('#dbgNav [data-dbg-tab=report]')
        await pg.wait_for_timeout(200)
        await pg.click('[data-dbg-act=save-report]')
        await pg.wait_for_timeout(300)
        rep = await E("document.getElementById('dbgBody').innerText")
        ok('Отчёт сохранён' in rep and 'Открыть папку' in rep, 'отчёт сохранён, есть «Открыть папку»')
        ok(await E("window.app.debugReveal('report')") is True, 'открытие папки отчёта доступно')

        # 5б. «Падения»: три имитации; в обычном профиле кнопки неактивны (задание 6).
        await pg.click('#dbgNav [data-dbg-tab=crashes]')
        await pg.wait_for_timeout(200)
        cr = await E("document.getElementById('dbgBody').innerText")
        ok('Окно упало' in cr and 'Окно зависло' in cr and 'Повреждён файл настроек' in cr, 'падения: три имитации на месте')
        ok('Только в тестовом профиле' in cr, 'падения: подпись про тестовый профиль')
        ok(await E("Array.from(document.querySelectorAll('#dbgBody [data-dbg-act]')).every(b=>b.disabled)"), 'падения: в обычном профиле кнопки неактивны')

        # 6. «tapyor debugger» — не команда, меню не открывается (после перезагрузки).
        await pg.reload()
        await pg.wait_for_timeout(600)
        await pg.fill('#search', 'tapyor debugger')
        await pg.press('#search', 'Enter')
        await pg.wait_for_timeout(400)
        ok(await E("document.getElementById('sDebug').hidden") is True, 'debugger: раздел остался скрыт')
        ok(await E("!document.getElementById('goDebug')"), 'debugger: пункта «Отладка» нет')

        ok(len(errs) == 0, 'ошибки страницы: ' + str(errs))
        await b.close()


asyncio.run(main())
srv.terminate()
