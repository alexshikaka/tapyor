# Тестовый сервер с поддержкой Range (перемотка видео/звука) — у python -m http.server её нет
import http.server, os, re, sys
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_head(self):
        path = self.translate_path(self.path)
        rng = self.headers.get('Range')
        if not rng or not os.path.isfile(path): return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng); size = os.path.getsize(path)
        a = int(m.group(1)) if m.group(1) else 0; b = int(m.group(2)) if m.group(2) else size - 1
        b = min(b, size - 1); f = open(path, 'rb'); f.seek(a)
        self.send_response(206); self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, b, size)); self.send_header('Content-Length', str(b - a + 1))
        self.send_header('Accept-Ranges', 'bytes'); self.end_headers()
        self._left = b - a + 1; return f
    def copyfile(self, src, dst):
        left = getattr(self, '_left', None)
        if left is None: return super().copyfile(src, dst)
        while left > 0:
            buf = src.read(min(65536, left))
            if not buf: break
            dst.write(buf); left -= len(buf)
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
