// Шаблоны секретов живут в src/secret-patterns.js (CommonJS) — одна правда на программу и инструменты.
// Этот файл оставлен для старых импортов tools/*.mjs: список и функция redact берутся оттуда.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../src/secret-patterns.js');

export const SECRET_PATTERNS = core.SECRET_PATTERNS;
export const ALLOWED_SECRET_HASHES = core.ALLOWED_SECRET_HASHES;
export const redact = core.redact;
