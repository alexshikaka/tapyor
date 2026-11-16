# 0.34.0, задание 5: имитация сбоев и тестовый заказ (поддельный window.app, не Тапёр)
import asyncio, os, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8797', '--bind', '127.0.0.1'],
                       cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)


MOCK = r"""
window.__fault = { modes: {} };
window.__calls = { set: [], clear: 0, test: [] };
window.__snap = () => ({
  ok: true,
  modes: Object.assign({}, window.__fault.modes),
  active: Object.keys(window.__fault.modes).map(k => ({ service: k, mode: window.__fault.modes[k] }))
});
window.app.faultGet = async () => window.__snap();
window.app.faultSet = async (s, m) => {
  window.__calls.set.push([s, m]);
  if (m) window.__fault.modes[s] = m; else delete window.__fault.modes[s];
  return window.__snap();
};
window.app.faultClear = async () => { window.__calls.clear++; window.__fault.modes = {}; return window.__snap(); };
window.app.reqTest = async (o) => {
  window.__calls.test.push(o);
  return { key: 'test:1', prov: 'test', test: true, name: o.name, text: o.text, amount: o.amount,
    service: o.service, level: 'exact', state: 'new', got: Date.now(),
    items: [{ level: 'exact', track: { src: 'ym', id: '1', title: 'Кукушка', author: 'Кино' } }] };
};
window.app.debugState = async () => ({ ok: true, state: {
  version: '0.34.0', build: 'stable', buildText: 'стабильная', commit: 'abc1234',
  channel: 'stable', channelText: 'стабильная', license: 'нет',
  pack: 'не установлен', modules: { bot: false, overlay: false },
  logins: { youtube: false, yandex: false, donationalerts: false, donatepay: false, twitch: false, lastfm: false, github: false },
  autofix: { youtube: 0, yandex: 0, donationalerts: 0, donatepay: 0, twitch: 0, lastfm: 0, github: 0 },
  dataDir: 'C:/Temp/demo-test-x', fault: [],
  load: { watch: true, current: {}, peaks: {} }, verbose: false
} });
"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(MOCK)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8797/app2/index.html')
        await pg.wait_for_timeout(700)
        E = pg.evaluate
        vis = lambda sel: E(f"(()=>{{var e=document.querySelector('{sel}'); return !!e && e.offsetParent!==null}})()")

        await pg.fill('#search', 'tapyor debug')
        await pg.press('#search', 'Enter')
        await pg.wait_for_timeout(500)

        # 1. Раздел «Имитация сбоев»: таблица сервис × режим.
        ok(await E("!!document.querySelector('#dbgNav [data-dbg-tab=fault]')"), 'раздел «Имитация сбоев» появился')
        await pg.click('#dbgNav [data-dbg-tab=fault]')
        await pg.wait_for_timeout(300)
        body = await E("document.getElementById('dbgBody').innerText")
        ok('Выключить всё' in body and 'недоступен' in body and 'вход отозван' in body, 'таблица и кнопка «Выключить всё»')
        rows = await E("document.querySelectorAll('#dbgBody .dbg-fault tbody tr').length")
        ok(rows == 8, 'строк в таблице: ' + str(rows) + ' (вся сеть + 7 сервисов)')

        # 2. Включение: переспрос один раз за сессию, плашка вверху.
        await pg.check('[data-fault-service=yt][value=down]')
        await pg.wait_for_timeout(250)
        txt = await E("(document.querySelector('.ask')||{}).innerText || ''")
        ok('Включить имитацию сбоя?' in txt and 'YouTube' in txt and 'после перезапуска' in txt, 'переспрос включения понятен')
        await pg.click('.ask-b [data-x="1"]')
        await pg.wait_for_timeout(350)
        ok(await E("JSON.stringify(window.__calls.set)") == '[["yt","down"]]', 'включение YouTube «недоступен» вызвано')
        ok(await vis('#faultBar'), 'плашка «Включена имитация сбоя» видна')
        bar = await E("document.getElementById('faultBarText').innerText")
        ok('Включена имитация сбоя' in bar and 'YouTube' in bar and 'недоступен' in bar, 'плашка называет сервис и режим')
        ok(await E("document.querySelector('[data-fault-service=yt][value=down]').checked") is True, 'радиокнопка отметилась')

        # 3. Второе включение — без переспроса (один раз за сессию).
        await pg.check('[data-fault-service=lastfm][value=auth]')
        await pg.wait_for_timeout(350)
        ok(await E("(()=>{var e=document.querySelector('.ask-ov'); if(!e) return false; var r=e.getBoundingClientRect(); return r.width>0 && r.height>0;})()") is False, 'второе включение без переспроса')
        ok(await E("window.__calls.set.length") == 2 and await E("window.__calls.set[1][0]") == 'lastfm', 'второй режим применён')

        # 4. «Выключить всё»: плашка скрывается, режимов нет.
        await pg.click('[data-dbg-act=fault-clear]')
        await pg.wait_for_timeout(300)
        ok(await E("window.__calls.clear") == 1, '«Выключить всё» вызвано')
        ok(await E("document.getElementById('faultBar').hidden") is True, 'плашка скрылась')
        ok(await E("Object.keys(window.__fault.modes).length") == 0, 'режимы сняты')

        # 5. Тестовый заказ: форма с умолчаниями, переспрос, вызов с пометкой.
        await pg.click('#dbgNav [data-dbg-tab=testorder]')
        await pg.wait_for_timeout(300)
        ok(await E("document.getElementById('dbgTestName').value") == 'Тестовый зритель', 'имя по умолчанию')
        ok(await E("document.getElementById('dbgTestSum').value") == '100', 'сумма по умолчанию 100')
        ok(await E("document.getElementById('dbgTestText').value") == 'Кино — Кукушка', 'текст по умолчанию')
        await pg.fill('#dbgTestName', 'Проверка')
        await pg.fill('#dbgTestSum', '250')
        await pg.select_option('#dbgTestService', 'dp')
        await pg.fill('#dbgTestText', 'Кино — Кукушка')
        await pg.click('[data-dbg-act=test-order]')
        await pg.wait_for_timeout(250)
        txt = await E("(document.querySelector('.ask')||{}).innerText || ''")
        ok('Создать тестовый заказ?' in txt and 'Деньги не двигаются' in txt and '«тест»' in txt, 'переспрос тестового заказа честный')
        await pg.click('.ask-b [data-x="1"]')
        await pg.wait_for_timeout(400)
        call = await E("JSON.stringify(window.__calls.test[0])")
        ok('"name":"Проверка"' in call and '"amount":250' in call and '"service":"dp"' in call and '"text":"Кино — Кукушка"' in call, 'заказ собран из формы: ' + call)
        ok('Последний тестовый заказ' in await E("document.getElementById('dbgBody').innerText"), 'результат тестового заказа показан')

        # 6. Пометка «тест» в списке заказов рисуется из r.test (проверяем саму функцию карточки).
        ok(await E("typeof rqCardHtml") == 'function', 'карточка заказа доступна')
        note = await E("rqCardHtml({ name:'Тестовый зритель', prov:'test', test:true, service:'dp', amount:100, currency:'RUB', at:Date.now(), level:'exact', items:[{level:'exact',track:{id:'1'},paid:true}] }, 0)")
        ok('тест' in note and 'DonatePay' in note, 'карточка тестового заказа: значок «тест» и сервис')

        ok(len(errs) == 0, 'ошибки страницы: ' + str(errs))
        await b.close()


asyncio.run(main())
srv.terminate()
