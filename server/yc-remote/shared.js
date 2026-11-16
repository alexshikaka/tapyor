'use strict';
// Где лежит общий код облачных функций (server/common/*.js).
// В репозитории функция лежит отдельно от server/common, а при упаковке tools/cloud-pack.mjs кладёт
// common/ рядом с index.js. Поэтому сначала смотрим рядом (собранная функция), потом на уровень выше
// (запуск из репозитория: dev-server.js и ручные проверки).
const fs = require('fs');
const path = require('path');

const local = path.join(__dirname, 'common');
const dir = fs.existsSync(path.join(local, 'reply.js')) ? local : path.join(__dirname, '..', 'common');

module.exports = (name) => require(path.join(dir, name));
