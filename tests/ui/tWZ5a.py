import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess, json
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8818','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
BRIDGE = """
window.__wcmds = []; window.__wclosed = 0; window.__wev = null;
window.wizardApi = {
  cmd: function(c){ window.__wcmds.push(JSON.parse(JSON.stringify(c))); },
  onEvent: function(cb){ window.__wev = cb; },
  close: function(){ window.__wclosed++; }
};
"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':480,'height':900}); await pg.add_init_script(script=BRIDGE)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8818/app2/wizard/index.html'); await pg.wait_for_timeout(700)
        E=pg.evaluate

        async def init(step, facts, frm='settings'):
            await E("window.__wev(%s)" % json.dumps({'type': 'init', 'from': frm, 'step': step, 'facts': facts}, ensure_ascii=False))
            await pg.wait_for_timeout(180)
        async def title():
            return await E("document.getElementById('wizTitle').textContent")
        async def cmds():
            return await E("window.__wcmds")

        def hl_of(cs):
            return [c for c in cs if c.get('op') == 'highlight']

        # ── 1–2. OBS (15.11, слово владельца): шаг только показывает, что есть, и открывает «OBS и стрим» ──
        await E("window.__wcmds = []")
        await init('obs', {'pack': {'installed': False}})
        assert await title() == 'Что есть для OBS', 'открылся не шаг OBS: %r' % await title()
        assert await E("document.querySelectorAll('#wizBody .wiz-obs-list li').length") == 2, 'без пака — два пункта (без оверлея)'
        assert await E("!document.querySelector('#wizBody .wiz-task')"), 'задач у шага OBS больше нет'
        h = hl_of(await cmds())
        assert h and h[-1].get('pane') == 'sObs' and h[-1].get('sel') == '#setStreamBlock', 'OBS: не подсвечен блок «Стримерам»: %r' % (h,)
        await init('obs', {'pack': {'installed': True}})
        assert await E("document.querySelectorAll('#wizBody .wiz-obs-list li').length") == 3, 'с паком — и оверлей'
        print('OBS: обзор — ок')

        # ── 3. Шага «Заказы из чата» нет (снят 16.11, слово владельца) ──
        assert await E("WIZARD.routeFor('streamer').map(function(s){return s.id}).indexOf('chat')") == -1, 'шаг чата остался в маршруте'

        # ── 6. Финал: чек-лист из фактов, «Настроить» и фон для эфира ──
        facts_ok = {
            'music': {'ym': True, 'yt': False, 'ymEnabled': True, 'ytEnabled': True},
            'donations': {'da': True, 'dp': False},
            'rules': {'tier': 'default', 'auto': False},
            'chat': {'mode': 'pack'},
            'pack': {'installed': True, 'enabled': True, 'state': 'trial', 'daysLeft': 30},
            'orders': {'tested': True},
            'sbot': {'status': 'off'},
            'site': {'url': 'https://example.test/', 'connected': True}
        }
        await init('streamer-final', facts_ok)
        assert await title() == 'Готов к эфиру', 'открылся не финал стримера'
        rows = await E("Array.from(document.querySelectorAll('#wizBody .wiz-check-row')).map(function(r){return r.textContent;})")
        assert len(rows) == 7, 'в чек-листе %d пунктов вместо 7' % len(rows)
        joined = ' | '.join(rows)
        for need in ['Музыка', 'Яндекс · вход ✓', 'DonationAlerts на связи', 'Сбалансированно', 'оба пути ✓', 'OBS', 'Настройки → OBS и стрим', 'наш бот · пробный, 30 дн.', 'Сайт-визитка', 'готова']:
            assert need in joined, 'в чек-листе нет «%s»: %s' % (need, joined)
        assert await E("document.querySelectorAll('#wizBody .wiz-lamp').length") == 7, 'у OBS должна быть пустая лампочка-отступ'
        assert await E("document.querySelectorAll('#wizBody [data-fix]').length") == 0, 'у зелёного чек-листа не должно быть «Настроить»'
        print('финал: пункты —', [r.split('\n')[0][:22] for r in rows])

        facts_bad = {
            'music': {'ym': False, 'yt': False, 'ymEnabled': True, 'ytEnabled': True},
            'donations': {},
            'rules': {},
            'chat': {'mode': 'none'},
            'orders': {},
            'site': {}
        }
        await init('streamer-final', facts_bad)
        fixes = await E("Array.from(document.querySelectorAll('#wizBody [data-fix]')).map(function(b){return b.getAttribute('data-fix');})")
        assert fixes == ['logins', 'donations', 'orders', 'donations'], 'не те «Настроить»: %r' % (fixes,)
        await E("window.__wcmds = []")
        await E("document.querySelector('#wizBody [data-fix=logins]').click()"); await pg.wait_for_timeout(150)
        assert (await cmds())[-1] == {'op': 'do', 'name': 'openStep', 'args': {'step': 'logins'}}, '«Настроить» открыла не этот шаг: %r' % (await cmds())[-1]

        assert await E("!document.querySelector('#wizBody [data-final=bg]')"), 'кнопка «Включить фон» должна быть убрана (16.11)'
        assert await E("!document.getElementById('wizNext').hidden"), 'на финале нет обычной «Дальше»'
        print('финал: обычная «Дальше» — ок')

        # ── 7. Шаг из настроек закрывается после «Готово», полный визард — нет ──
        await init('obs', {'pack': {'installed': False}})
        assert await E("document.getElementById('wizNext').textContent") == 'Готово', 'в одиночном шаге кнопка не «Готово»'
        await E("window.__wclosed = 0")
        await E("document.getElementById('wizNext').click()"); await pg.wait_for_timeout(150)
        assert await E("window.__wclosed") == 1, 'одиночный шаг не закрылся после «Готово»'

        await init('obs', {'pack': {'installed': False}}, frm='first')
        await E("window.__wclosed = 0")
        await E("document.getElementById('wizNext').click()"); await pg.wait_for_timeout(150)
        assert await E("window.__wclosed") == 0, 'в полном визарде шаг закрыл окно вместо перехода'
        assert await title() == 'Взаимодействие со зрителями', 'полный визард не перешёл к следующему шагу (после OBS — «Зрители»): %r' % await title()
        print('одиночный шаг закрывается, полный — идёт дальше')

        print('ошибки:', errs)
        assert not errs, 'ошибки страницы: %s' % errs
        await b.close()
asyncio.run(main()); srv.terminate()
