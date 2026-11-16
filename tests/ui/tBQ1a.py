# BQ1a (16.11.2026): проверки Тапёра и пак стримера. Пак не включён или не скачан — строки чат-бота
# не считаются проблемой (замечание владельца: после визарда пак выключен, а проверка показывала ошибку).
import os, asyncio, subprocess
CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
from playwright.async_api import async_playwright

PORT = 8779
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd='.',
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)

SET = """(st) => { window.app.modStatus = function(){ return Promise.resolve(st); }; return botLoad(false).then(function(){ return 1; }); }"""
BOT_ROWS = "(function(){var o={};['bot.login','bot.chat','bot.points','bot.license'].forEach(function(id){var it=QC.items[id];o[id]=it?it.state:null});return o})()"
BOT_PROBLEMS = "healthWarnList().filter(function(n){return /Чат-бот/.test(n)})"
IN_LIST = "QC_ALL.filter(function(id){return id.indexOf('bot.')===0}).length"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
        errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.add_init_script(path='mock5.js')
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:%d/app2/index.html' % PORT)
        await pg.wait_for_timeout(1200)
        E = pg.evaluate

        # Пак установлен, но не включён (пробного нет) — строки есть, серые, проблем нет
        await E(SET, {'installed': True, 'running': False, 'manifest': {'version': '0.4.0', 'modules': []}, 'license': {'enabled': False, 'state': 'none'}})
        await pg.wait_for_timeout(200)
        rows = await E(BOT_ROWS)
        ok(all(v == 'off' for v in rows.values()), 'пак не включён — строки бота серые: %r' % rows)
        ok(await E(BOT_PROBLEMS) == [], 'и не считаются проблемой')
        ok(await E("QC.items['bot.chat'].text") == 'пак не включён', 'подпись «пак не включён»')

        # Пробный период закончился — тоже не ошибка
        await E(SET, {'installed': True, 'running': False, 'manifest': {'version': '0.4.0', 'modules': []}, 'license': {'enabled': False, 'state': 'trial-ended'}})
        await pg.wait_for_timeout(200)
        ok(await E(BOT_PROBLEMS) == [], 'пробный период закончился — не проблема')

        # Часы переведены назад — это проблема (жёлтая)
        await E(SET, {'installed': True, 'running': False, 'manifest': {'version': '0.4.0', 'modules': []}, 'license': {'enabled': False, 'state': 'clock'}})
        await pg.wait_for_timeout(200)
        ok(await E("QC.items['bot.license'].state") == 'warn', 'часы переведены назад — жёлтая строка')

        # Пак работает, но ботом не пользуются (заказы из чата у Streamer.bot или ни у кого) — строки серые
        await E("""(function(){
          window.app.botCmd = function(c){
            if (c === 'health') return Promise.resolve([{id:'bot.login', state:'warn', text:'войди как стример'}, {id:'bot.chat', state:'bad', text:'нет связи'}]);
            if (c === 'settings') return Promise.resolve({banMin:10, access:{}, event:{}, reward:{}});
            if (c === 'status') return Promise.resolve(window.__bs || {});
            return Promise.resolve([]);
          };
          window.app.getSetting = (function(orig){ return function(k){ return k === 'chatOrders' ? Promise.resolve(window.__co || 'none') : orig(k); }; })(window.app.getSetting);
          return 1; })()""")
        await E("window.__co = 'sbot'")
        await E(SET, {'installed': True, 'running': True, 'manifest': {'version': '0.4.0', 'modules': []}, 'license': {'enabled': True, 'state': 'trial', 'daysLeft': 20}})
        await pg.wait_for_timeout(300)
        rows = await E(BOT_ROWS)
        ok(rows['bot.login'] == 'off' and rows['bot.chat'] == 'off', 'бот не используется — вход и чат серые: %r' % rows)
        ok(await E("QC.items['bot.login'].text") == 'чат-бот не используется', 'подпись «чат-бот не используется»')
        ok(await E(BOT_PROBLEMS) == [], 'и не считаются проблемой')
        # Пользуются ботом — настоящие состояния
        await E("window.__co = 'pack'")
        await E(SET, {'installed': True, 'running': True, 'manifest': {'version': '0.4.0', 'modules': []}, 'license': {'enabled': True, 'state': 'trial', 'daysLeft': 20}})
        await pg.wait_for_timeout(300)
        rows = await E(BOT_ROWS)
        ok(rows['bot.login'] == 'off' and await E("QC.items['bot.login'].text") == 'в Twitch не входили', 'бот принимает заказы, но в Twitch не входили — тоже серые: %r' % rows)
        ok(await E(BOT_PROBLEMS) == [], 'и не считаются проблемой')
        # Вход был (сохранён), но устарел — это проблема
        await E("window.__bs = {chat:{login:'me'}, broadcaster:{login:'me'}}")
        await E(SET, {'installed': True, 'running': True, 'manifest': {'version': '0.4.0', 'modules': []}, 'license': {'enabled': True, 'state': 'trial', 'daysLeft': 20}})
        await pg.wait_for_timeout(300)
        ok(await E("QC.items['bot.login'].state") == 'warn' and await E("QC.items['bot.chat'].state") == 'bad', 'вход был, бот принимает заказы — настоящие проблемы видны')

        # Пак не скачан (или удалён) — строк бота в проверке нет
        ok(await E(IN_LIST) == 4, 'пока пак есть — 4 строки бота в списке')
        await E(SET, {'installed': False, 'license': {'enabled': False, 'state': 'not-installed'}})
        await pg.wait_for_timeout(200)
        ok(await E(IN_LIST) == 0, 'пака нет — строк бота в проверке нет')
        ok(await E(BOT_PROBLEMS) == [], 'и проблем бота нет')

        print('ошибки:', errs)
        ok(not errs, 'без ошибок страницы')
        await b.close()

try:
    asyncio.run(main())
finally:
    srv.terminate()
