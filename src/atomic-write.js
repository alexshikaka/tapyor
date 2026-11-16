'use strict';
// Общая запись файла «через временный» (R5): рядом создаётся временный файл, данные
// сбрасываются на диск (fsync), затем переименование поверх старого. Если переименование
// не удалось, временный файл удаляется, а ошибка уходит вызывающему: он решает, писать
// об этом в журнал или промолчать. Без Electron — покрыто unit-тестами.
const fs = require('fs');
const path = require('path');

let seq = 0;

function writeFileAtomic(file, text) {
  const dir = path.dirname(file);
  const temp = path.join(dir, '.' + path.basename(file) + '.tmp-' + process.pid + '-' + (++seq));
  let fd = null;
  try {
    fd = fs.openSync(temp, 'w');
    fs.writeFileSync(fd, text == null ? '' : String(text), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, file);
    return true;
  } catch (e) {
    if (fd != null) { try { fs.closeSync(fd); } catch (x) {} }
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (x) {}
    throw e;
  }
}

module.exports = { writeFileAtomic };
