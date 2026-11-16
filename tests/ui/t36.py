# 0.34.0, задание 4: тестовый профиль и сбросы с автокопией (поддельный window.app, не Тапёр)
import asyncio, os, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8796', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)


MOCK = r"""
window.__calls = { start: 0, ret: 0, reset: [], restore: [] };
window.app.debugProfile = async () => ({ test: localStorage.getItem('tpTest') === '1', dir: 'C:/Temp/demo-test-x' });
window.app.debugState = async () => ({ ok: true, state: {
  version: '0.34.0', build: 'stable', buildText: 'стабильная', commit: 'abc1234',
  channel: 'stable', channelText: 'стабильная', license: 'полная',
  pack: 'не установлен', modules: { bot: false, overlay: false },
  logins: { youtube: false, yandex: false, donationalerts: false, donatepay: false, twitch: false, lastfm: false, github: false },
  autofix: { youtube: 0, yandex: 0, donationalerts: 0, donatepay: 0, twitch: 0, lastfm: 0, github: 0 },
  testProfile: localStorage.getItem('tpTest') === '1',
  dataDir: 'C:/Temp/demo-test-x',
  load: { watch: true, current: {}, peaks: {} }, verbose: false
} });
window.app.debugBackups = async () => ({ ok: true, items: JSON.parse(localStorage.getItem('tpBackups') || '[]') });
window.app.debugTestProfileStart = async () => { window.__calls.start++; return { ok: true }; };
window.app.debugTestProfileReturn = async () => { window.__calls.ret++; return { ok: true }; };
window.app.debugReset = async (k) => { window.__calls.reset.push(k); return { ok: true, id: 'x' }; };
window.app.debugRestore = async (id) => { window.__calls.restore.push(id); return { ok: true, id: id }; };
window.app.debugPeaksReset = async () => ({ ok: true, peaks: {} });
"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(MOCK)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8796/app2/index.html')
        await pg.wait_for_timeout(700)
        E = pg.evaluate
        vis = lambda sel: E(f"(()=>{{var e=document.querySelector('{sel}'); return !!e && e.offsetParent!==null}})()")

        async def open_menu():
            await pg.fill('#search', 'tapyor debug')
            await pg.press('#search', 'Enter')
            await pg.wait_for_timeout(500)

        async def confirm():
            await pg.wait_for_timeout(200)
            shown = await E("(()=>{var e=document.querySelector('.ask-ov'); if(!e) return false; var r=e.getBoundingClientRect(); return r.width>0 && r.height>0;})()")
            ok(shown, 'диалог переспроса показан')
            await pg.click('.ask-b [data-x="1"]')
            await pg.wait_for_timeout(300)

        # 1. Обычный профиль: первая карточка — тестовый профиль, ничего не скрыто.
        await E("localStorage.removeItem('tpTest'); localStorage.setItem('tpBackups','[]')")
        await pg.reload()
        await pg.wait_for_timeout(600)
        await open_menu()
        ok(await E("document.getElementById('testProfileBar').hidden") is True, 'обычный профиль: плашки нет')
        top = await E("(document.getElementById('dbgTop')||{}).innerText || ''")
        ok('Тестовый профиль' in top and 'Ваши входы, ключи, плейлисты и очередь не тронутся' in top, 'первая карточка описывает профиль')
        ok(await vis('[data-dbg-act=test-profile]'), 'есть кнопка перезапуска в тестовом профиле')

        # 2. Переспрос входа: слова про браузерные сессии, затем вызов.
        await pg.click('[data-dbg-act=test-profile]')
        await pg.wait_for_timeout(250)
        txt = await E("(document.querySelector('.ask')||{}).innerText || ''")
        ok('Перезапустить в тестовом профиле?' in txt and 'Сессии входа в браузерной вкладке' in txt, 'переспрос входа понятен')
        await confirm()
        ok(await E("window.__calls.start") == 1, 'перезапуск в тестовом профиле вызван')

        # 3. Сбросы: карточки и честные тексты; отмена не сбрасывает.
        ok(await E("!!document.querySelector('#dbgNav [data-dbg-tab=resets]')"), 'раздел «Сбросы» появился')
        await pg.click('#dbgNav [data-dbg-tab=resets]')
        await pg.wait_for_timeout(300)
        body = await E("document.getElementById('dbgBody').innerText")
        ok('Сбросить настройки' in body and 'Сбросить лицензию' in body and 'Сбросить триал' in body, 'три сброса на месте')
        ok('Место на сервере не освобождается' in body, 'текст сброса лицензии честный')
        ok('повторно взять его на этом ПК нельзя' in body, 'текст сброса триала честный')
        ok('Копий пока нет' in body, 'пустой список копий объяснён')

        await pg.click('[data-dbg-act=reset][data-kind=settings]')
        await pg.wait_for_timeout(250)
        txt = await E("(document.querySelector('.ask')||{}).innerText || ''")
        ok('Останутся: входы и ключи, лицензии, плейлисты, темы' in txt, 'переспрос настроек перечисляет, что останется')
        await pg.click('.ask-b [data-x="0"]')
        await pg.wait_for_timeout(200)
        ok(await E("window.__calls.reset.length") == 0, 'отмена не сбрасывает')

        await pg.click('[data-dbg-act=reset][data-kind=settings]')
        await confirm()
        ok(await E("window.__calls.reset.join(',')") == 'settings', 'сброс настроек вызван после подтверждения')

        # 4. Копии: «Вернуть как было» сверху и список с датой/видом.
        # Дата копии — явная, а не «сейчас минус 2 часа»: иначе проверка зависела бы
        # от времени суток (после полуночи дата сдвигалась и тест падал ни с того ни с сего).
        await E("localStorage.setItem('tpBackups', JSON.stringify([{id:'2026-11-11_19-00-00-settings', kind:'settings', at: new Date(2026,10,11,19,0,0).getTime(), version:'0.33.1'}]))")
        await pg.reload()
        await pg.wait_for_timeout(600)
        await open_menu()
        await pg.click('#dbgNav [data-dbg-tab=resets]')
        await pg.wait_for_timeout(300)
        body = await E("document.getElementById('dbgBody').innerText")
        ok('Вернуть как было' in body, 'последняя копия — кнопкой сверху')
        ok('Резервные копии' in body and 'настройки' in body and '11.11.2026' in body, 'список копий: дата и вид')
        await pg.click('[data-dbg-act=restore]')
        await pg.wait_for_timeout(250)
        txt = await E("(document.querySelector('.ask')||{}).innerText || ''")
        ok('Текущие настройки будут заменены копией' in txt, 'переспрос восстановления понятен')
        await confirm()
        ok(await E("window.__calls.restore[0]") == '2026-11-11_19-00-00-settings', 'восстановление копии вызвано')

        # 5. Тестовый профиль: плашка сверху, строка в «Состоянии», возврат с переспросом.
        await E("localStorage.setItem('tpTest','1')")
        await pg.reload()
        await pg.wait_for_timeout(700)
        ok(await vis('#testProfileBar'), 'тестовый профиль: плашка вверху видна')
        bar = await E("document.getElementById('testProfileBar').innerText")
        ok('Тестовый профиль' in bar and 'Вернуться в мой профиль' in bar, 'плашка: заголовок и кнопка')
        await open_menu()
        ok(await E("(document.getElementById('dbgTop').innerText||'').trim()") == '', 'в тестовом профиле карточки входа нет')
        st = await E("document.getElementById('dbgBody').innerText")
        ok('тестовый (временная папка)' in st, 'в «Состоянии» строка про тестовый профиль')

        await pg.click('#testProfileBack')
        await pg.wait_for_timeout(250)
        txt = await E("(document.querySelector('.ask')||{}).innerText || ''")
        ok('Тестовый профиль будет удалён' in txt, 'переспрос возврата объясняет удаление')
        await confirm()
        ok(await E("window.__calls.ret") == 1, 'возврат в обычный профиль вызван')

        ok(len(errs) == 0, 'ошибки страницы: ' + str(errs))
        await b.close()


asyncio.run(main())
srv.terminate()
