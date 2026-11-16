// Проверка вердиктов на выдуманных сообщениях с придуманной выдачей поиска: node tests/reqparse/judge.js
const R = require('../../src/reqparse');
const T = (author, title, seconds, extra) => Object.assign({ author, title, seconds: seconds || 200 }, extra || {});
const cases = [
  ['Мельница и ХелависаМельница и Хелависа - Дорога сна (Песня года)', T('Мельница', 'Дорога сна'), 'exact'],
  ['Хорошего вечера!!!! Rammstein- sonne', T('Rammstein', 'Sonne'), 'exact'],
  ['Nirvana-Smells Like Teen Spirit немного бодрой музыки для игры', T('Nirvana', 'Smells Like Teen Spirit'), 'exact'],
  ['Smells Like Teen Spirit - Nirvana', T('Nirvana', 'Smells Like Teen Spirit'), 'exact'],
  ['утром заряжаться Numb - Linkin Pаrk', T('Linkin Park', 'Numb'), 'exact'],
  ['о Матушка Россия - Хор Иона Дамаскина', T('Хор Иоанна Дамаскина', 'О, Матушка Россия'), 'exact'],
  ['Дорога сна - Мельниця', T('Мельница', 'Дорога сна'), 'exact'],
  ['поставь сплин выхода нет плиз', T('Сплин', 'Выхода нет'), 'exact'],
  ['включи песню про дождь', T('ДДТ', 'Дождь'), 'doubt'],
  ['NIGHTWISH Amaranth', T('Nightwish', 'Amaranth'), 'exact'],
  ['Выкати пожалуйста Штиль и Грозу', T('Ария', 'Штиль'), 'doubt'],
  ['Спасибо за стрим, хорошего вечера!', T('Ирина Аллегрова', 'Хороший вечер'), 'none'],
];
let ok = 0;
cases.forEach(([m, t, want]) => { const j = R.judge(m, t); const pass = j.level === want; ok += pass; console.log((pass ? 'OK  ' : 'FAIL') + ' ' + j.level.padEnd(5) + ' (ждали ' + want + ') ' + m.slice(0, 50) + ' ⇒ ' + t.author + ' — ' + t.title); });
console.log('флажки:', JSON.stringify(R.flags(T('Сборник', 'Лучшее за 2000-е', 3735), 'поставь', { maxSec: 420, stopWords: R.DEFAULT_STOP })), JSON.stringify(R.flags(T('Artist', 'Song (Sped Up)', 150, { explicit: true }), 'Artist - Song', { stopWords: R.DEFAULT_STOP })), JSON.stringify(R.flags(T('X', 'Pride Anthem', 180), 'X - Pride Anthem', { stopWords: R.DEFAULT_STOP })), JSON.stringify(R.flags(T('Gamer', 'Обзор корабля Тигр', 600), 'Тигр', { stopWords: R.DEFAULT_STOP })));
console.log(ok + '/' + cases.length);
process.exit(ok === cases.length ? 0 : 1);
