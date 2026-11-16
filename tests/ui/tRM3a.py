# RM3a: окно «Настройки → Модули → Пульт с телефона» (src/ui/35-remote.js, docs/REMOTE.md).
#  - пункт меню появляется, когда пак установлен и в status().modules есть remote;
#  - раздел показывает QR и состояние, кнопки зовут start/renew/stop;
#  - опрос status идёт раз в 2 с только пока раздел открыт;
#  - режим Wi-Fi: переключатель, адрес/сеть, выбор адреса и подсказки по vpn/publicNet/selfOk;
#  - старый пак без lan — переключателя нет; ошибок страницы нет.
import os, sys, json, socket, asyncio, subprocess
from playwright.async_api import async_playwright

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8779

QR = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ffffff"></rect></svg>'

MOCK_RM = r"""
(function(){
  window.__rm = {
    cmds: [], statusCalls: 0,
    st: {
      installed: true,
      manifest: { version: '1.0.0', modules: [ { id: 'remote', name: 'Пульт с телефона' } ] },
      modules: { remote: { name: 'Пульт с телефона', running: true, error: null } },
      license: { enabled: true }
    },
    status: {
      state: 'connected', phoneAgo: 2000, qrSvg: %s, url: 'http://192.168.1.5:47660/#sid.key',
      lan: null
    }
  };
  window.app.modStatus = function(){ return Promise.resolve(window.__rm.st); };
  window.app.modCmd = function(id, cmd, data){
    window.__rm.cmds.push({ id: id, cmd: cmd, data: data || null });
    if (cmd === 'status') { window.__rm.statusCalls++; return Promise.resolve(window.__rm.status); }
    return Promise.resolve({ ok: true });
  };
})();
""" % json.dumps(QR)


def port_free(port):
    # TIME_WAIT после прошлого прогона — не «занят»: проверяем, отвечает ли кто-то на порту.
    s = socket.socket()
    try:
        s.settimeout(0.3)
        s.connect(('127.0.0.1', port))
        return False
    except OSError:
        return True
    finally:
        s.close()


def ok(c, m):
    print(('✓ ' if c else '✗ ') + m)
    if not c:
        raise SystemExit(1)


async def main():
    if not port_free(PORT):
        print('✗ порт %d занят другим тестом — освободи и запусти снова' % PORT)
        raise SystemExit(1)
    if not os.path.exists(os.path.join(HERE, 'loud.wav')):
        subprocess.run([sys.executable, 'gen_audio.py'], cwd=HERE, check=False)
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                           cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = 'http://127.0.0.1:%d' % PORT
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=(CH if os.path.exists(CH) else None))
            pg = await b.new_page(viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.add_init_script(path=os.path.join(HERE, 'mock5.js'))
            await pg.add_init_script(script=MOCK_RM)
            await pg.goto(base + '/app2/index.html')
            await pg.wait_for_timeout(900)
            E = pg.evaluate

            async def cmds():
                return json.loads(await E("JSON.stringify(window.__rm.cmds)"))

            async def last_cmd(name):
                cs = [c for c in await cmds() if c['cmd'] == name]
                return cs[-1] if cs else None

            # 1. Пак и модуль есть — пункт меню появился, раздел открывается.
            await E("setTab('settings')")
            await pg.wait_for_timeout(150)
            await E("rmLoad()")
            await pg.wait_for_timeout(120)
            ok(await E("!document.getElementById('goRemote').hidden"), 'пункт «Пульт с телефона» появился')
            await pg.click('#goRemote')
            await pg.wait_for_timeout(300)
            ok(not await E("document.getElementById('sRemote').hidden"), 'раздел sRemote открылся')
            ok(await E("!!document.querySelector('#rmQr svg')"), 'показан QR (SVG из status.qrSvg)')
            state = await E("document.querySelector('#rmPanel .rm-state').textContent")
            ok('Телефон подключён' in state and '2 с назад' in state, 'состояние: %r' % state)
            ok('Не показывай этот код и ссылку на стриме' in (await E("document.getElementById('rmPanel').textContent")),
               'предупреждение про стрим есть')
            # 16.11: рядом с QR — сама ссылка и «Скопировать ссылку»
            ok(await E("document.getElementById('rmLink') && document.getElementById('rmLink').textContent") == 'http://192.168.1.5:47660/#sid.key',
               'под QR показана ссылка пульта')
            ok(await E("!!document.querySelector('#rmPanel [data-rm-copy=link]')"), 'есть кнопка «Скопировать ссылку»')

            # 2. Кнопки зовут start/renew/stop.
            await pg.click('#rmStart')
            await pg.wait_for_timeout(150)
            ok((await last_cmd('start')) is not None, '«Подключить телефон» зовёт start')
            await pg.click('#rmRenew')
            await pg.wait_for_timeout(150)
            ok((await last_cmd('renew')) is not None, '«Новая ссылка» зовёт renew')
            await pg.click('#rmStop')
            await pg.wait_for_timeout(150)
            ok((await last_cmd('stop')) is not None, '«Отключить телефон» зовёт stop')

            # 3. Опрос идёт только пока раздел открыт.
            await pg.wait_for_timeout(300)
            n0 = await E("window.__rm.statusCalls")
            await pg.wait_for_timeout(2400)
            n1 = await E("window.__rm.statusCalls")
            ok(n1 > n0, 'пока раздел открыт, status опрашивается (было %d, стало %d)' % (n0, n1))
            await pg.click('[data-go="sAbout"]')
            await pg.wait_for_timeout(400)
            n2 = await E("window.__rm.statusCalls")
            await pg.wait_for_timeout(2400)
            n3 = await E("window.__rm.statusCalls")
            ok(n3 == n2, 'раздел закрыт — опроса нет (было %d, стало %d)' % (n2, n3))

            # 4. Режим Wi-Fi: переключатель и команда mode.
            await pg.click('#goRemote')
            await pg.wait_for_timeout(200)
            await E("""(function(){
              window.__rm.status.state = 'waiting';
              window.__rm.status.phoneAgo = null;
              window.__rm.status.lan = {
                on: false, url: 'http://192.168.1.5:47660', ip: '192.168.1.5', net: '192.168.1.0/24', port: 47660,
                vpn: { pc: true, names: ['WireGuard'] }, publicNet: true, selfOk: false,
                addrs: [ { ip: '192.168.1.5', name: 'Wi-Fi' }, { ip: '10.0.0.5', name: 'Ethernet' } ]
              };
              return true;
            })()""")
            await E("rmLoad()")
            await pg.wait_for_timeout(150)
            ok(await E("!!document.getElementById('rmMode')"), 'есть переключатель «Через интернет / По Wi-Fi»')
            ok(await E("document.querySelector('#rmMode [data-rm-mode=lan]').classList.contains('on')") is False,
               'по умолчанию выбран «Через интернет»')
            await pg.click('#rmMode [data-rm-mode="lan"]')
            await pg.wait_for_timeout(150)
            mc = await last_cmd('mode')
            ok(mc is not None and mc['data'] == {'mode': 'lan'}, 'переключатель зовёт mode {mode:lan}: %r' % (mc and mc['data']))

            # 5. Подсказки: VPN на ПК, сеть, телефон, «Общедоступная» и «сервер не отвечает».
            await E("window.__rm.status.lan.on = true; true")
            await E("rmLoad()")
            await pg.wait_for_timeout(150)
            txt = await E("document.getElementById('rmPanel').textContent")
            ok(await E("!!document.querySelector('#rmPanel .bot-note.rm-vpn')"), 'подсказка про VPN выделена акцентом')
            for word in ['VPN на телефоне и на ПК может блокировать прямое подключение', 'включён VPN (WireGuard)', '192.168.1.0/24', 'Разрешить локальную сеть',
                         'Сервер не отвечает', 'Общедоступная', '192.168.1.5', 'Скопировать']:
                ok(word in txt, 'подсказка/строка «%s» есть' % word)
            ok(await E("document.querySelectorAll('#rmAddrs [data-rm-ip]').length") == 2, 'выбор адреса: 2 варианта')
            await pg.click('#rmAddrs [data-rm-ip="10.0.0.5"]')
            await pg.wait_for_timeout(150)
            ic = await last_cmd('lan-ip')
            ok(ic is not None and ic['data'] == {'ip': '10.0.0.5'}, 'выбор адреса зовёт lan-ip {ip}: %r' % (ic and ic['data']))

            # 6. Старый пак без lan — переключателя нет.
            await E("delete window.__rm.status.lan; window.__rm.status.state='waiting'; true")
            await E("rmLoad()")
            await pg.wait_for_timeout(150)
            ok(await E("document.getElementById('rmMode') === null"), 'нет поля lan — переключателя нет')

            # 7. Модуля remote в паке нет — пункт меню скрыт.
            await E("delete window.__rm.st.modules.remote; true")
            await E("rmLoad()")
            await pg.wait_for_timeout(120)
            ok(await E("document.getElementById('goRemote').hidden"), 'без модуля remote пункт меню скрыт')
            await E("window.__rm.st.modules.remote = { name: 'Пульт с телефона', running: true, error: null }; true")

            print('ошибки:', errs)
            ok(not errs, 'без ошибок страницы')
            await b.close()
    finally:
        srv.terminate()


try:
    asyncio.run(main())
except SystemExit:
    raise
