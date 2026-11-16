// Шаг визарда «Музыка с компьютера» (WIZ6-COACH.md). Своей кнопки «Выбрать папку» больше нет:
// шаг подсвечивает настоящую кнопку Настройки → «Музыка с компьютера» (#setLibAdd).
// Задача отмечается, когда главное окно сообщило, что папок ≥ 1.
// Список папок и прогресс чтения остаются сводкой — это не кнопки.
'use strict';

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const registry = isNode ? require('../steps.js') : (root && root.WIZARD);
  const api = factory(registry);
  if (isNode) module.exports = api;
  else if (registry && typeof registry.register === 'function') registry.register(api.step);
})(typeof window !== 'undefined' ? window : null, function (registry) {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('ru-RU'); }
  function plural(n) {
    n = Number(n) || 0; const a = n % 100, b = n % 10;
    if (a >= 11 && a <= 14) return 'песен';
    if (b === 1) return 'песня';
    if (b >= 2 && b <= 4) return 'песни';
    return 'песен';
  }

  // «Читаю файлы… N из M · можно идти дальше»; после конца — пусто.
  function progressText(p) {
    if (!p || p.finished) return '';
    const done = Number(p.done) || 0, total = Number(p.total) || 0;
    if (!total) return 'Читаю файлы…';
    return 'Читаю файлы… ' + num(done) + ' из ' + num(total) + ' · можно идти дальше';
  }
  // Сколько нашлось, когда чтение закончилось.
  function foundText(status) {
    const n = status && Number(status.count) || 0;
    if (!n) return 'Песен с компьютера пока нет.';
    return 'Нашлось: ' + num(n) + ' ' + plural(n) + '. Они будут браться первыми.';
  }

  // Задача шага: ссылка на настоящую кнопку раздела Настройки → «Музыка с компьютера».
  function folderTasks() {
    return [{
      id: 'folder',
      text: 'Добавь папку с музыкой',
      sub: 'Нажми «Добавить папку…» и покажи, где лежит музыка. Обычно это системная папка «Музыка».',
      tab: 'settings',
      pane: 'sLocal',
      sel: '#setLibAdd',
      on: 'none',
      optional: true
    }];
  }

  const step = {
    id: 'local',
    routes: ['listener', 'streamer'],
    label: 'Музыка с компьютера',
    title: 'Есть музыка на компьютере?',
    lead: 'Покажи папку — Тапёр сам прочитает файлы и разложит по исполнителям и альбомам.',
    skippable: true,
    render(el, api) {
      el.__wizCurrent = 'local';
      localStep.el = el;
      if (localStep.ctl) { try { localStep.ctl.stop(); } catch (e) {} localStep.ctl = null; }
      el.innerHTML = '';
      const box = el.__wizLocal = {
        data: { status: null, progress: null, web: true },
        api: api,
        status: null,
        coach: null
      };
      if (registry && typeof registry.coach === 'function') {
        box.coach = registry.coach(el, api, { tasks: folderTasks() });
      }
      box.status = document.createElement('div');
      box.status.className = 'wiz-lc-status';
      el.appendChild(box.status);
      localStep.ctl = box.coach;
      paint(el);
    },
    onEnter(api) {
      const st = { un: null, api: api };
      localStep.state = st;
      api.cmd({ op: 'do', name: 'wizReset' });
      st.un = api.on('local', function (d) {
        const el = localStep.el;
        if (!el || el.__wizCurrent !== 'local' || !el.__wizLocal || !d) return;
        const data = el.__wizLocal.data;
        if (d.status) data.status = d.status;
        if (d.progress) data.progress = d.progress;
        if (typeof d.web === 'boolean') data.web = d.web;
        paint(el);
      });
      api.cmd({ op: 'do', name: 'localWatch', args: { on: true } });
    },
    onLeave() {
      const st = localStep.state;
      if (st && typeof st.un === 'function') st.un();
      const api = st && st.api;
      if (api) api.cmd({ op: 'do', name: 'localWatch', args: { on: false } });
      localStep.state = null;
      localStep.el = null;
      if (localStep.ctl) { try { localStep.ctl.stop(); } catch (e) {} localStep.ctl = null; }
    }
  };

  const localStep = { el: null, state: null, ctl: null, step: step };

  // Папка добавлена — задача отмечена. Число папок присылает главное окно (libStatus).
  function syncDone(box) {
    if (!box || !box.coach) return;
    const folders = (box.data.status && box.data.status.folders) || [];
    if (folders.length >= 1) box.coach.done('folder');
    else box.coach.undone('folder');
  }

  function paint(el) {
    const box = el.__wizLocal;
    if (!box || !box.status) return;
    const d = box.data;
    const folders = (d.status && d.status.folders) || [];
    const found = (d.status && d.status.count) || 0;
    const scan = d.progress && !d.progress.finished ? d.progress : null;

    let h = '';
    if (d.web === false) {
      h += '<div class="wiz-lc-strong">Сейчас онлайн-площадки недоступны — <b>музыка с компьютера играет всегда</b>, даже без интернета.</div>';
    }
    if (folders.length) {
      h += '<div class="wiz-lc-card"><div class="wiz-lc-l">' + (folders.length === 1 ? 'Папка' : 'Папки') + '</div>'
        + folders.map(function (f) {
          return '<div class="wiz-lc-path">' + esc(f.path || '') + '</div>';
        }).join('');
      if (scan) {
        const pct = scan.total ? Math.max(2, Math.min(100, Math.round((scan.done / scan.total) * 100))) : 4;
        h += '<div class="wiz-lc-bar"><i style="width:' + pct + '%"></i></div>'
          + '<div class="wiz-lc-prog">' + esc(progressText(scan)) + '</div>';
      } else if (found) {
        h += '<div class="wiz-lc-prog">' + esc(foundText({ count: found })) + '</div>';
      }
      h += '</div>';
    } else {
      if (!scan && !found) h += '<p class="wiz-lc-note">Пока папок нет.</p>';
      if (scan) {
        const pct2 = scan.total ? Math.max(2, Math.min(100, Math.round((scan.done / scan.total) * 100))) : 4;
        h += '<div class="wiz-lc-bar"><i style="width:' + pct2 + '%"></i></div>'
          + '<div class="wiz-lc-prog">' + esc(progressText(scan)) + '</div>';
      } else if (found) {
        h += '<div class="wiz-lc-prog">' + esc(foundText({ count: found })) + '</div>';
      }
    }
    h += '<p class="wiz-lc-note">Когда соберёшь плейлист из списка или из ВК, песни, которые есть на компьютере, Тапёр возьмёт отсюда в первую очередь.</p>';
    box.status.innerHTML = h;
    syncDone(box);
  }

  return {
    step: step,
    tasks: folderTasks,
    progressText: progressText,
    foundText: foundText
  };
});
