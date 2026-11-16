import os
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
import asyncio, subprocess, sys
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8783','--bind','127.0.0.1'], cwd='.', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Поддельные ответы: быстрая проверка всегда показывает проблему yt.dlp,
# глубокая отвечает сразу и считает вызовы. На старом коде «быстрая → глубокая → быстрая»
# крутится каждые ~5 секунд; после исправления за 20 секунд должна быть ровно одна.
FAKE = """
(function(){
  var a = window.app;
  a.qcRun = function(){
    return Promise.resolve({ at: Date.now(), ms: 40, items: {
      net: { state: 'ok', text: 'есть' },
      app: { state: 'ok', text: '0.35.1' },
      recipes: { state: 'ok', text: 'v1' },
      'ym.svc': { state: 'ok', text: 'доступен' },
      'ym.acc': { state: 'ok', text: 'вход есть' },
      'ym.play': { state: 'ok', text: 'поток получен' },
      'ym.site': { state: 'off', text: 'выключен' },
      'yt.svc': { state: 'ok', text: 'доступен' },
      'yt.login': { state: 'ok', text: 'вход есть' },
      'yt.dlp': { state: 'bad', text: 'движок не обновляется' },
      sc: { state: 'ok', text: 'доступны' },
      refs: { state: 'ok', text: 'доступны' },
      tg: { state: 'ok', text: 'сайт доступен' }
    } });
  };
  window.__healthRuns = 0;
  a.healthRun = function(){
    window.__healthRuns++;
    window.__log.push('healthRun');
    return Promise.resolve({ at: Date.now(), recipes: { version: 1, source: 'тест' }, services: {
      yandex: { status: 'ok', title: 'Работает', steps: [] },
      youtube: { status: 'ok', title: 'Работает', steps: [] }
    } });
  };
})();
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        pg = await b.new_page(viewport={'width':1440,'height':1000})
        await pg.add_init_script(path='mock5.js')
        await pg.add_init_script(path='ov8.js')
        await pg.add_init_script(script=FAKE)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:8783/app2/index.html')
        await pg.wait_for_timeout(20000)
        E = pg.evaluate
        n1 = await E("window.__healthRuns")
        print('глубокая проверка за 20 секунд:', n1)
        ok = (n1 == 1)
        if not ok:
            print('✗ ожидалась 1 глубокая проверка — петля не разорвана')
        # Кнопка «Проверить сейчас» не ограничена: после неё вызовов ровно на один больше.
        await E("$('hsRun').click()")
        await pg.wait_for_timeout(1500)
        n2 = await E("window.__healthRuns")
        print('после «Проверить сейчас»:', n2)
        if n2 != n1 + 1:
            print('✗ кнопка «Проверить сейчас» не запустила глубокую проверку')
            ok = False
        # Чистая функция решения: тот же набор — не чаще 30 минут, новый набор — сразу.
        checks = [
            ('тот же набор через 29 минут — нельзя', await E("healthByQcAllowed(Date.now(), 'yt.dlp', { key: 'yt.dlp', at: Date.now() - 29*60*1000 })"), False),
            ('тот же набор через 31 минуту — можно', await E("healthByQcAllowed(Date.now(), 'yt.dlp', { key: 'yt.dlp', at: Date.now() - 31*60*1000 })"), True),
            ('набор изменился — можно', await E("healthByQcAllowed(Date.now(), 'yt.dlp', { key: 'ym.play', at: Date.now() })"), True),
            ('пустой набор — нельзя', await E("healthByQcAllowed(Date.now(), '', { key: '', at: 0 })"), False)
        ]
        for name, got, want in checks:
            print(name + ':', got)
            if got != want:
                print('✗ ожидалось ' + str(want))
                ok = False
        print('ошибки:', errs)
        await b.close()
        return ok

ok = asyncio.run(main())
srv.terminate()
if not ok:
    print('✗ t44: петля «быстрая ↔ глубокая проверка» не разорвана')
    sys.exit(1)
print('t44: ок')
