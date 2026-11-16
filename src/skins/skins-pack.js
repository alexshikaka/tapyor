// Данные оболочек — часть будущего отдельного модуля (решение 01.11).
// Ядро читает их из window.TapSkinPack. Нет этого файла — оболочек нет, работает «Стандарт».
// Механизм (применение, схемы, единое состояние вида) остаётся в src/ui/01-skins.js.
(function () {
  'use strict';
  var skins = [
    { id: 'dos',  name: 'VGA / DOS', sub: 'серые панели с фаской', tag: '90-е',     bg: '#007878', card: '#c0c0c0', line: '#000080', txt: '#000000', btn: '#c0c0c0', pixel: true },
    { id: 'crt',  name: 'Неон-скан', sub: 'CRT и свечение',        tag: 'CRT',      bg: '#0b0b12', card: '#191527', line: '#ff2d95', txt: '#f2eeff', btn: '#00e5ff', pixel: true },
    { id: 'retro', name: 'Ретро-десктоп', sub: 'серо-чёрный, фаски 95-го', tag: '90-е', bg: '#1b1b1e', card: '#3a3a40', line: '#74747c', txt: '#e9e9ec', btn: '#c6c6ca', pixel: true }
  ];
  var schemes = {
    dos: [
      { id: 'classic', name: 'Оригинал VGA / DOS', legacy: true, desc: 'Исходная оболочка: бирюзовый рабочий стол, платиновые панели и чёрный текст — как на экране DOS.',
        core: { bg: '#007878', panel: '#C0C0C0', surface: '#D0D0D0', line: '#808080', text: '#000000', accent: '#000080', button: '#C0C0C0' } },
      { id: 'turbo', name: 'Turbo Pascal', desc: 'Тёмно-синий экран IDE #000080, серый текст #C0C0C0, бирюзовые линии #00A8A8 и жёлтые подсказки #FFFF55 — как первый день в Turbo Pascal.',
        core: { bg: '#000080', panel: '#000060', surface: '#000070', line: '#00A8A8', text: '#C0C0C0', accent: '#FFFF55', button: '#00A8A8' } },
      { id: 'amber', name: 'Янтарный монитор', desc: 'P3-фосфор: тёмно-коричневый, почти чёрный экран #1A0F00 и янтарные буквы #FFB000 — так читали документы до цветной VGA.',
        core: { bg: '#1A0F00', panel: '#241600', surface: '#2E1C00', line: '#7A4A00', text: '#FFB000', accent: '#FFD27A', button: '#FFB000' } },
      { id: 'bbs', name: 'BBS / ANSI', desc: 'Доски объявлений и ANSI-арт: чёрный фон, циан и маджента — цвета модемных вечеров.',
        core: { bg: '#0A0A0A', panel: '#141414', surface: '#1E1E1E', line: '#3C3C3C', text: '#C0C0C0', accent: '#00FFFF', button: '#FF55FF' } }
    ],
    crt: [
      { id: 'neon', name: 'Оригинал · Неон-скан', desc: 'Исходная оболочка: неоново-розовый #FF2D95 и циан #00E5FF на почти чёрном #0B0B12 — скан-линии и свечение люминофора.',
        core: { bg: '#0B0B12', panel: '#12101E', surface: '#191527', line: '#3A2F5C', text: '#F2EEFF', accent: '#FF2D95', button: '#00E5FF' } },
      { id: 'p1', name: 'P1 · зелёный фосфор', desc: 'Классический зелёный терминал: монохром, скан-линии и чувство, что ты в ЦУПе.',
        core: { bg: '#03110A', panel: '#061A10', surface: '#0A2418', line: '#1F5A3A', text: '#B7FFD2', accent: '#33FF99', button: '#33FF99' } },
      { id: 'p3', name: 'P3 · янтарь', desc: 'P3-янтарь: тёплый почти чёрный экран #120B04, бледно-янтарный текст #FFD9A0 и оранжевый акцент #FFAE33 — мягче зелёного фосфора.',
        core: { bg: '#120B04', panel: '#1C1208', surface: '#24180C', line: '#5A3A12', text: '#FFD9A0', accent: '#FFAE33', button: '#FFAE33' } },
      { id: 'vhs', name: 'VHS', desc: 'Выцветшая VHS: тёмный сине-серый корпус #1B1D24, кремовые титры #EDE6D8, розовая полоса записи #FF7A9A и голубой индикатор #7FD0FF.',
        core: { bg: '#1B1D24', panel: '#242732', surface: '#2D3140', line: '#4A5064', text: '#EDE6D8', accent: '#FF7A9A', button: '#7FD0FF' } },
      { id: 'sign', name: 'Неон-вывеска', desc: 'Ночная вывеска: маджента и циан на почти чёрном, свечение как у лампового неона.',
        core: { bg: '#06020E', panel: '#150B2A', surface: '#1F1140', line: '#7A4FE0', text: '#FFFFFF', accent: '#FF4FD8', button: '#4DF3FF' } },
    ],
    retro: [
      { id: 'graphite', name: 'Оригинал · Ретро-десктоп', legacy: true, desc: 'Исходная оболочка: графитовый корпус, стальные кромки 95-го и синеватый акцент — как было до схем.',
        core: { bg: '#1B1B1E', panel: '#26262A', surface: '#303035', line: '#5C5C64', text: '#E9E9EC', accent: '#8AA4C8', button: '#C6C6CA' } },
      { id: 'win95', name: 'Windows 95', desc: 'Платиновый интерфейс 95-го: светлые панели, тёмный текст и синий заголовок окна.',
        core: { bg: '#C3C7CB', panel: '#D8DCE0', surface: '#F0F2F4', line: '#8A8F96', text: '#101418', accent: '#000080', button: '#C0C0C0' } },
      { id: 'platinum', name: 'Mac OS Platinum', desc: 'Платина Apple 8–9: ровный серый #DDDDDD, панели #ECECEC, почти чёрный текст #1A1A1A и один синий акцент #3366CC — без глянца.',
        core: { bg: '#DDDDDD', panel: '#ECECEC', surface: '#F5F5F5', line: '#9A9A9A', text: '#1A1A1A', accent: '#3366CC', button: '#DDDDDD' } },
      { id: 'beos', name: 'BeOS', desc: 'Синие окна и жёлтая полоса BeOS R5 — операционная система, которая опередила время.',
        core: { bg: '#1A2A6C', panel: '#3366CC', surface: '#3F73D6', line: '#0B1B45', text: '#FFFFFF', accent: '#FFD400', button: '#FFD400' } },
      { id: 'motif', name: 'Motif / CDE', desc: 'Motif/CDE: пыльный сланец #2F3A44, серый металл панелей #3E4A56 и оранжевый акцент #E08A3C — Solaris, HP-UX, первые CDE.',
        core: { bg: '#2F3A44', panel: '#3E4A56', surface: '#4A5765', line: '#6C7C8C', text: '#E6EDF2', accent: '#E08A3C', button: '#8A9AA8' } }
    ],
  };
  window.TapSkinPack = { version: 1, skins: skins, schemes: schemes };
})();
