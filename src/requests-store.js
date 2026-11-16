'use strict';
// Заказы со стрима: чтение и запись requests.json (R5).
// При чтении проверяем, что разобранное — массив: верный JSON не того вида раньше
// ронял requests.slice/requests.find в главном процессе. Битый файл или не-список:
// журнал, попытка .bak, затем переименование в .broken-…. Запись — через временный
// файл с fsync (src/atomic-write.js); .bak хранит прошлую версию. Без Electron.
const fs = require('fs');
const path = require('path');
const atomic = require('./atomic-write');

const MAX = 300;

function read(file, opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : () => {};
  const name = path.basename(file);
  const parse = (f) => {
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(v)) throw new Error('в файле не список');
    return v;
  };
  try {
    return parse(file);
  } catch (e) {
    log('заказы: не прочитать ' + name + ' — ' + ((e && e.message) || e));
    try {
      const v = parse(file + '.bak');
      log('заказы: восстановил из ' + name + '.bak');
      return v;
    } catch (e2) {
      try { if (fs.existsSync(file)) fs.renameSync(file, file + '.broken-' + Date.now() + '.json'); } catch (e3) { log('заказы: битый файл не отложен — ' + ((e3 && e3.message) || e3)); }
      return [];
    }
  }
}

function save(file, list, opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : () => {};
  const name = path.basename(file);
  try {
    const arr = Array.isArray(list) ? list.slice(-MAX) : [];
    // .bak — прошлая версия: копируем до переименования нового файла.
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch (e0) { log('заказы: копия .bak не сделана — ' + ((e0 && e0.message) || e0)); }
    atomic.writeFileAtomic(file, JSON.stringify(arr));
    return true;
  } catch (e) {
    log('заказы: не сохранить ' + name + ' — ' + ((e && e.message) || e));
    return false;
  }
}

module.exports = { read, save, MAX };
