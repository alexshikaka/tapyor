# 11.11 (0.33.0 → 0.33.1): кнопки раздела «О программе» должны открывать свои адреса, а не молчать.
# Проверяем каждую кнопку: вызов открытия ссылки с ОЖИДАЕМЫМ адресом (браузер не запускается —
# window.app поддельный, он пишет вызовы в window.__log), и переход «Сменить в „Программе“».
import os, asyncio, subprocess
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8790','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c: raise SystemExit(1)

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg=await b.new_page(viewport={'width':1440,'height':900}); await pg.add_init_script(path='mock5.js')
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8790/app2/index.html'); await pg.wait_for_timeout(900)
        E=pg.evaluate

        await pg.click('#tabs [data-tab=settings]'); await pg.wait_for_timeout(300)
        first = await E("(()=>{var b=document.querySelector('.set-side button[data-go]'); return b?b.dataset.go:''})()")
        ok(first == 'sAbout', '«О программе» — первый пункт меню настроек: ' + str(first))
        await pg.click('.set-side [data-go=sAbout]'); await pg.wait_for_timeout(600)

        # Все кнопки раздела на месте и активны (кроме «Сайт» — его ещё нет, А13)
        btns = await E("Array.from(document.querySelectorAll('#sAbout [data-about]')).map(b=>[b.dataset.about, b.disabled])")
        d = dict(btns)
        ok(d.get('repo') is False and d.get('issues') is False and d.get('privacy') is False
           and d.get('tg') is False and d.get('tgchat') is False, 'ссылки «О программе» активны')
        ok(d.get('site') is True, '«Сайт» пока выключен (А13) — так и должно быть')
        ok(d.get('da') is False and d.get('yoomoney') is False, 'ссылки «Поддержать автора» активны')

        # Клик по каждой кнопке должен дать ровно один вызов открытия с ожидаемым адресом
        async def opened(dead_click_sel):
            await pg.evaluate("window.__log.length = 0")
            await pg.click(dead_click_sel, force=True)
            await pg.wait_for_timeout(250)
            return await E("window.__log.slice()")

        log = await opened('#sAbout [data-about=repo]')
        ok(log == ['open https://github.com/alexshikaka/tapyor'], '«Открыть» исходный код: ' + str(log))

        log = await opened('#sAbout [data-about=privacy]')
        ok(log == ['open https://github.com/alexshikaka/tapyor/blob/main/PRIVACY.md'], '«Открыть» политику данных: ' + str(log))

        log = await opened('#sAbout [data-about=tg]')
        ok(log == ['open https://t.me/tapyor'], '«Открыть» Telegram-канал: ' + str(log))

        log = await opened('#sAbout [data-about=tgchat]')
        ok(log == ['open https://t.me/tapyorchat'], '«Открыть» Telegram-чат: ' + str(log))

        # «Поддержать автора» (G4): блок на месте, обе ссылки открывают свои адреса
        ok(await E("Array.from(document.querySelectorAll('#sAbout .sec-h h2')).some(h=>h.textContent.indexOf('Поддержать')>=0)"),
           'блок «Поддержать автора» есть в разделе')
        log = await opened('#sAbout [data-about=da]')
        ok(log == ['open https://www.donationalerts.com/r/alexshikaka'], '«Поддержать» DonationAlerts: ' + str(log))
        log = await opened('#sAbout [data-about=yoomoney]')
        ok(log == ['open https://yoomoney.ru/to/410011529262377'], '«Поддержать» ЮMoney: ' + str(log))

        # «Написать»: задача на GitHub с версией, сборкой и коммитом — и без личных данных
        log = await opened('#sAbout [data-about=issues]')
        ok(len(log) == 1 and log[0].startswith('open https://github.com/alexshikaka/tapyor/issues/new/choose?labels=bug&title='),
           '«Написать» ведёт в задачи: ' + str(log)[:120])
        url = log[0][5:] if log else ''
        from urllib.parse import unquote
        dec = unquote(url)
        ok('0.6.0' in dec and 'Сборка: dev' in dec and 'Коммит: abc1234' in dec,
           'в задаче есть версия, сборка и коммит')
        ok('@' not in dec and 'C:\\Users' not in dec and 'C:/Users' not in dec,
           'в задаче нет почты и путей ПК')

        # «Сменить в „Программе“»: переход в раздел «Программа» и переключатель канала на виду
        await pg.click('#sAbout [data-go=sApp]', force=True); await pg.wait_for_timeout(700)
        nav = await E("""(()=>{
            const seg=document.getElementById('setChannel');
            const r=seg?seg.getBoundingClientRect():null;
            const main=document.querySelector('.set-main').getBoundingClientRect();
            return {about: document.getElementById('sAbout').hidden,
                    app: document.getElementById('sApp').hidden,
                    side: Array.from(document.querySelectorAll('.set-side [data-go]')).filter(b=>b.classList.contains('on')).map(b=>b.dataset.go),
                    segInView: !!(r && r.top>=main.top-5 && r.bottom<=main.bottom+5)};
        })()""")
        ok(nav['about'] is True and nav['app'] is False, '«Сменить в „Программе“» открывает «Программу»: ' + str(nav))
        ok(nav['side'] == ['sApp'], 'пункт «Программа» подсвечен в меню: ' + str(nav['side']))
        ok(nav['segInView'], 'переключатель канала прокручен на виду')

        ok(not errs, 'без ошибок страницы: ' + str(errs))
        print('ошибки:', errs)
        await b.close()
try: asyncio.run(main())
finally: srv.terminate()
