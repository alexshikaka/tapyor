// Закреплённая версия yt-dlp (P5a №7): разбор resources/yt-dlp.version.json.
// Версия и sha256 лежат в репозитории, а не берутся из «последнего выпуска» на лету:
// иначе у разных тегов Тапёра в установщике разные бинарники и сборка невоспроизводима.
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}(\.\d{1,6})?$/;
const SHA_RE = /^[0-9a-f]{64}$/i;

function bad(error) {
  return { ok: false, pinned: false, version: '', sha256: '', error };
}

// Пустая version — осознанное «как раньше, latest»: это не ошибка, но CI пишет предупреждение.
export function checkPin(jsonText) {
  let j;
  try {
    j = JSON.parse(String(jsonText == null ? '' : jsonText));
  } catch {
    return bad('resources/yt-dlp.version.json не разбирается как JSON');
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return bad('resources/yt-dlp.version.json: ожидался объект { version, sha256 }');
  const version = typeof j.version === 'string' ? j.version.trim() : '';
  const sha256 = typeof j.sha256 === 'string' ? j.sha256.trim().toLowerCase() : '';
  if (!version) {
    if (sha256) return bad('sha256 указан без version — непонятно, к какому выпуску он относится');
    return { ok: true, pinned: false, version: '', sha256: '' };
  }
  if (!VERSION_RE.test(version)) return bad('version должен быть вида 2025.01.15 (номер выпуска yt-dlp), а не «' + version + '»');
  if (!SHA_RE.test(sha256)) return bad('для закреплённой version нужен sha256 — 64 шестнадцатеричных символа');
  return { ok: true, pinned: true, version, sha256 };
}

export function releaseBase(version, pinned) {
  return pinned
    ? 'https://github.com/yt-dlp/yt-dlp/releases/download/v' + version
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
}
