  // ===== Индикатор нагрузки в нижней панели (настройка perfWatch) =====
  // Два графика по две минуты истории и цифры под ними. Данные приходят готовыми
  // из главного процесса (perf-sample, опрос там же), здесь только рисование:
  // один setAttribute на график раз в 2 секунды — ни таймеров, ни анимаций,
  // поэтому правило calm ничего не требует.
  // Цвет линии — currentColor от .perf-g, темы и оболочки перекрашивают её сами.
  var PF = { n: 60, cpu: [], mem: [] };
  var pfBox = $('perfHud'), pfCpuV = $('perfCpu'), pfMemV = $('perfMem'),
      pfCpuLn = $('perfCpuLine'), pfMemLn = $('perfMemLine');

  // Границы графика. Память рисуем не от нуля: иначе колебание в 5 МБ на фоне
  // 400 даёт идеально прямую линию и смысла в графике нет. Но и пустяк раздувать
  // не хотим — отсюда минимальный размах.
  function pfRange(arr, span, fromZero){
    var lo = fromZero ? 0 : Infinity, hi = 0, i;
    for (i = 0; i < arr.length; i++) { if (arr[i] > hi) hi = arr[i]; if (!fromZero && arr[i] < lo) lo = arr[i]; }
    if (!isFinite(lo)) lo = 0;
    if (hi - lo < span) { var mid = (hi + lo) / 2; lo = mid - span / 2; if (lo < 0) lo = 0; hi = lo + span; }
    return [lo, hi];
  }

  function pfDraw(line, arr, span, fromZero){
    if (!line || !arr.length) return;
    var r = pfRange(arr, span, fromZero), lo = r[0], k = r[1] - lo, n = arr.length, pts = '', i, x, y;
    for (i = 0; i < n; i++) {
      x = n < 2 ? 120 : (i * 120) / (n - 1);
      y = 23 - (k > 0 ? Math.max(0, Math.min(1, (arr[i] - lo) / k)) : 0) * 21;
      pts += (i ? ' ' : '') + (Math.round(x * 10) / 10) + ',' + (Math.round(y * 10) / 10);
    }
    line.setAttribute('points', pts);
  }

  function pfSample(d){
    if (!pfBox || !d) return;
    if (pfBox.hidden) pfBox.hidden = false;
    PF.cpu.push(d.cpu || 0); if (PF.cpu.length > PF.n) PF.cpu.shift();
    PF.mem.push(d.mem || 0); if (PF.mem.length > PF.n) PF.mem.shift();
    if (pfCpuV) pfCpuV.textContent = (d.cpu || 0).toFixed(1).replace('.', ',') + ' %';
    if (pfMemV) pfMemV.textContent = Math.round(d.mem || 0) + ' МБ';
    pfDraw(pfCpuLn, PF.cpu, 5, true);
    pfDraw(pfMemLn, PF.mem, 60, false);
  }

  function pfSync(){
    if (!pfBox || !A.getSetting) return;
    A.getSetting('perfWatch').then(function (v){
      pfBox.hidden = !v;
      if (!v) { PF.cpu = []; PF.mem = []; }
    });
  }

  if (pfBox) {
    pfSync();
    if (A.onPerfSample) A.onPerfSample(pfSample);
    // Тумблер в настройках — показать или спрятать сразу, не дожидаясь перезапуска
    document.addEventListener('click', function (e){
      var t = e.target && e.target.closest ? e.target.closest('[data-set-tg="perfWatch"]') : null;
      if (t) setTimeout(pfSync, 80);
    });
  }
