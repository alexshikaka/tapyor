import os
import asyncio
import subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
# WZ4/WC2: действия шагов «Донаты» и «Правила заказов» в главном окне.
# WC2: шаг «Донаты» больше не дублирует кнопки и поля Тапёра — визард подсвечивает настоящие
# элементы Настроек, поэтому проверяем состояние и сами элементы, а не удалённые действия.
srv = subprocess.Popen(['python3', '-m', 'http.server', '8777', '--bind', '127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def last_event(evs, kind):
    found = [e for e in evs if e.get('type') == kind]
    return found[-1] if found else None


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None), args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(path='mock_req.js')
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8777/app2/index.html')
        await pg.wait_for_timeout(900)
        E = pg.evaluate

        # ── Правила заказов: чтение и набор «Сбалансированно» ──────────────────
        await E("window.__wcmd({op:'do', name:'wz4RulesGet'})")
        await pg.wait_for_timeout(150)
        ev = last_event(await E("window.__wevents || []"), 'rulesState')
        assert ev is not None, 'шаг правил не получил состояние'
        print('правила при входе:', ev['auto'], '| стоп-лист:', ev['stopText'][:30])

        await E("window.__wcmd({op:'do', name:'wz4RulesApply', args:{reqAuto:true, explicitOk:false, repeatOk:false, versionOk:true, maxSec:420}})")
        await pg.wait_for_timeout(250)
        print('сбалансированно:', await E("JSON.stringify(window.__store.reqRules)"), '| reqAuto:', await E("window.__store.reqAuto"), '| RQ.auto:', await E("RQ.auto"))
        assert await E("window.__store.reqRules.explicitOk") is False
        assert await E("window.__store.reqRules.repeatOk") is False
        assert await E("window.__store.reqRules.versionOk") is True
        assert await E("window.__store.reqRules.maxSec") == 420
        assert await E("window.__store.reqAuto") is True
        assert await E("RQ.auto") is True
        assert await E("REQ_RULES.maxSec") == 420
        # переключатели в «Настройках → Заказы» показывают то же, что набор
        assert await E("document.getElementById('stExplicit').classList.contains('on')") is False
        assert await E("document.getElementById('stRepeat').classList.contains('on')") is False
        assert await E("document.getElementById('stVersion').classList.contains('on')") is True
        assert await E("document.getElementById('stMax').value") == '7'
        assert await E("document.querySelector('#sOrders [data-set-tg=\\'reqAuto\\']').classList.contains('on')") is True
        assert await E("document.querySelector('#viewReq [data-set-tg=\\'reqAuto\\']').classList.contains('on')") is True

        # ── Набор «Всё сразу в эфир»: переключатели показывают новое состояние ─
        await E("window.__wcmd({op:'do', name:'wz4RulesApply', args:{reqAuto:true, explicitOk:true, repeatOk:true, versionOk:true, maxSec:600}})")
        await pg.wait_for_timeout(250)
        assert await E("document.getElementById('stExplicit').classList.contains('on')") is True
        assert await E("document.getElementById('stRepeat').classList.contains('on')") is True
        assert await E("document.getElementById('stVersion').classList.contains('on')") is True
        assert await E("document.querySelector('#sOrders [data-set-tg=\\'reqAuto\\']').classList.contains('on')") is True
        assert await E("document.querySelector('#viewReq [data-set-tg=\\'reqAuto\\']').classList.contains('on')") is True
        assert await E("document.getElementById('stMax').value") == '10'
        print('всё сразу:', await E("JSON.stringify(window.__store.reqRules)"))

        # ── Стоп-лист правится в самих Настройках, набор его не затирает ────────
        await E("(function(){var t=document.getElementById('stStop');t.value='мат, война';t.dispatchEvent(new Event('change',{bubbles:true}));return true;})()")
        await pg.wait_for_timeout(150)
        print('стоп-лист:', await E("JSON.stringify(window.__store.reqRules.stopWords)"))
        assert await E("JSON.stringify(window.__store.reqRules.stopWords)") == '["мат","война"]'
        assert await E("window.__store.reqRules.explicitOk") is True, 'остальные поля набора не затёрлись'
        assert await E("JSON.stringify(REQ_RULES.stopWords)") == '["мат","война"]'
        # своего стоп-листа в визарде больше нет — действие удалено (WC2)
        assert await E("typeof WIZ_ACTIONS.wz4RulesStop") == 'undefined'

        # ── Донаты: состояние сервисов и цена ─────────────────────────────────
        await E("window.__store.reqPrice = 100; window.__store.reqCurrency = 'RUB';")
        await E("window.__wcmd({op:'do', name:'wz4DonState'})")
        await pg.wait_for_timeout(200)
        ev = last_event(await E("window.__wevents || []"), 'donState')
        assert ev is not None, 'шаг донатов не получил состояние сервисов'
        print('донаты:', 'DA', ev['da']['connected'], ev['da']['name'], '| DP', ev['dp']['connected'], '| цена', ev['price'], ev['currency'])
        assert ev['da']['connected'] is True and ev['da']['name'] == 'murzik'
        assert ev['dp']['connected'] is False
        assert ev['price'] == 100 and ev['currency'] == 'RUB'

        # ── Настоящие элементы шага в Настройках → Донаты ─────────────────────
        # Вход DA отключён — в #stDon появляется та самая кнопка «Подключить».
        await E("window.app.donDisconnect('da')")
        await E("window.__wcmd({op:'highlight',tab:'settings',pane:'sStream',sel:'#stPrice'})")
        await pg.wait_for_timeout(300)
        await E("window.app.donStatus().then(function(s){ window.__don(s); })")
        await pg.wait_for_timeout(400)
        assert await E("curTab") == 'settings'
        assert await E("settingsPaneId") == 'sStream'
        print('элементы донатов:', await E("JSON.stringify({da:!!document.querySelector('#stDon [data-don=\\'da\\']'),dp:!!document.querySelector('#stDon [data-dk=\\'dp\\']'),price:!!document.getElementById('stPrice'),cur:!!document.getElementById('stCur'),site:!!document.getElementById('stSite')})"))
        assert await E("!!document.querySelector('#stDon [data-don=\\'da\\']')") is True
        assert await E("!!document.querySelector('#stDon [data-dk=\\'dp\\']')") is True
        assert await E("!!document.getElementById('stPrice') && !!document.getElementById('stCur') && !!document.getElementById('stSite')") is True
        # удалённых копий больше нет: действия, которые вызывали свои кнопки, убраны
        assert await E("typeof WIZ_ACTIONS.wz4DonDa") == 'undefined'
        assert await E("typeof WIZ_ACTIONS.wz4DonKey") == 'undefined'
        assert await E("typeof WIZ_ACTIONS.wz4DonPrice") == 'undefined'
        assert await E("typeof WIZ_ACTIONS.wz4OpenSite") == 'undefined'

        print('ошибки:', errs)
        assert errs == [], 'ошибки страницы: ' + repr(errs)
        await b.close()


try:
    asyncio.run(main())
finally:
    srv.terminate()
