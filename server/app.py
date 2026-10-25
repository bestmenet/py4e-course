"""Local HTTP server for the offline Python for Everybody course.

Deliberately dependency-free: everything here runs on a stock Python 3.8+
interpreter using only the standard library, so the course works on any
machine that can run the code samples it teaches.

Responsibilities
----------------
* serve the single-page front end in ``web/``
* serve content from ``data/`` (curriculum model built by ``_scrape/``)
* serve media from ``static/`` (slide images, book figures, sample code)
* expose a small JSON API: search, chapter/deck bodies, code samples,
  progress persistence and sandboxed code execution

The server binds to 127.0.0.1 by default and is intended for a single local
user.  It is not hardened for exposure to a network.
"""
import json
import mimetypes
import os
import posixpath
import re
import socket
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB_DIR = os.path.join(ROOT, "web")
DATA_DIR = os.path.join(ROOT, "data")
STATIC_DIR = os.path.join(ROOT, "static")
VAR_DIR = os.path.join(ROOT, "var")

sys.path.insert(0, HERE)

import progress as progress_mod  # noqa: E402
import search as search_mod  # noqa: E402

try:
    import runner as runner_mod
except Exception as exc:  # pragma: no cover - the site still works without it
    runner_mod = None
    RUNNER_ERROR = str(exc)
else:
    RUNNER_ERROR = None

MAX_BODY = 512 * 1024
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("application/wasm", ".wasm")

# ---------------------------------------------------------------- utilities

JSON_CACHE = {}
JSON_LOCK = threading.Lock()


def read_json(path, cache=False):
    """Read a JSON file from disk, optionally memoised."""
    if cache:
        with JSON_LOCK:
            hit = JSON_CACHE.get(path)
        if hit is not None:
            return hit
    with open(path, "r", encoding="utf-8") as fh:
        value = json.load(fh)
    if cache:
        with JSON_LOCK:
            JSON_CACHE[path] = value
    return value


SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


def safe_join(base, *parts):
    """Join under ``base`` and refuse anything that escapes it."""
    candidate = os.path.normpath(os.path.join(base, *parts))
    base_abs = os.path.abspath(base)
    cand_abs = os.path.abspath(candidate)
    if cand_abs != base_abs and not cand_abs.startswith(base_abs + os.sep):
        return None
    return cand_abs


def guess_type(path):
    ctype, _ = mimetypes.guess_type(path)
    if ctype is None:
        return "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
        ctype += "; charset=utf-8"
    return ctype


ASSET_REF = re.compile(r'"(/assets/[^"?]+)"')


def asset_version():
    """Newest modification time under ``web/assets``.

    The shell is served no-store and stamps every asset URL with this, so
    editing a stylesheet or a view is picked up on the next reload instead of
    being hidden behind a cached copy.
    """
    newest = 0.0
    for root, _dirs, files in os.walk(os.path.join(WEB_DIR, "assets")):
        for name in files:
            try:
                newest = max(newest, os.path.getmtime(os.path.join(root, name)))
            except OSError:
                pass
    return str(int(newest))


def stamp_assets(html):
    """Append the current asset version to every ``/assets/...`` reference."""
    version = asset_version()
    return ASSET_REF.sub(lambda m: '"%s?v=%s"' % (m.group(1), version), html)


# ------------------------------------------------------------------- routes

class Api:
    """JSON API handlers.  Each returns (status, payload)."""

    def __init__(self):
        self.search = None
        self.search_error = None
        self._lock = threading.Lock()

    def index(self):
        if self.search is None and self.search_error is None:
            with self._lock:
                if self.search is None and self.search_error is None:
                    try:
                        self.search = search_mod.load_default()
                    except Exception as exc:  # noqa: BLE001
                        self.search_error = str(exc)
        return self.search

    # ---- content

    def course(self, query, body):
        return 200, read_json(os.path.join(DATA_DIR, "course.json"), cache=True)

    def chapter(self, query, body, slug):
        if not SAFE_NAME.match(slug or ""):
            return 400, {"error": "bad slug"}
        path = os.path.join(DATA_DIR, "chapters", "%s.json" % slug)
        if not os.path.exists(path):
            return 404, {"error": "no such chapter", "slug": slug}
        return 200, read_json(path, cache=True)

    def guide(self, query, body, slug):
        if not SAFE_NAME.match(slug or ""):
            return 400, {"error": "bad slug"}
        path = os.path.join(DATA_DIR, "guides", "%s.json" % slug)
        if not os.path.exists(path):
            return 404, {"error": "no such guide", "slug": slug}
        return 200, read_json(path, cache=True)

    def deck(self, query, body, slug):
        if not SAFE_NAME.match(slug or ""):
            return 400, {"error": "bad slug"}
        path = os.path.join(DATA_DIR, "decks", "%s.json" % slug)
        if not os.path.exists(path):
            return 404, {"error": "no such deck", "slug": slug}
        return 200, read_json(path, cache=True)

    def search_api(self, query, body):
        q = (query.get("q") or [""])[0]
        try:
            limit = min(int((query.get("limit") or ["25"])[0]), 100)
        except ValueError:
            limit = 25
        chapters = [c for c in (query.get("chapter") or []) if c]
        lessons_only = (query.get("lessons") or ["0"])[0] in ("1", "true")
        ix = self.index()
        if ix is None:
            return 503, {"error": "search index unavailable", "detail": self.search_error}
        hits = ix.search(q, limit=limit, chapters=chapters or None,
                         lessons_only=lessons_only)
        return 200, {
            "query": q,
            "count": len(hits),
            "results": [h.to_dict() for h in hits],
            "suggestions": ix.suggest(q, limit=6) if len(q) >= 2 else [],
        }

    def suggest(self, query, body):
        q = (query.get("q") or [""])[0]
        ix = self.index()
        if ix is None:
            return 200, {"suggestions": []}
        return 200, {"suggestions": ix.suggest(q, limit=8)}

    # ---- code library

    def code_list(self, query, body):
        course = read_json(os.path.join(DATA_DIR, "course.json"), cache=True)
        names = course.get("code_files", [])
        out = []
        for name in names:
            path = os.path.join(STATIC_DIR, "code", name)
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            out.append({"name": name, "bytes": size,
                        "kind": _code_kind(name)})
        return 200, {"count": len(out), "files": out}

    def code_one(self, query, body, name):
        if not SAFE_NAME.match(name or ""):
            return 400, {"error": "bad name"}
        path = safe_join(os.path.join(STATIC_DIR, "code"), name)
        if not path or not os.path.isfile(path):
            return 404, {"error": "no such file", "name": name}
        if os.path.getsize(path) > 4 * 1024 * 1024:
            return 413, {"error": "file too large to display inline", "name": name}
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        return 200, {"name": name, "kind": _code_kind(name),
                     "bytes": os.path.getsize(path), "text": text,
                     "runnable": name.endswith(".py")}

    # ---- execution

    def run(self, query, body):
        if runner_mod is None:
            return 503, {"error": "code runner unavailable", "detail": RUNNER_ERROR}
        code = body.get("code") or ""
        if not isinstance(code, str):
            return 400, {"error": "code must be a string"}
        if len(code) > 100_000:
            return 413, {"error": "code too long"}
        mode = body.get("mode") or "script"
        if mode not in ("script", "repl"):
            return 400, {"error": "mode must be script or repl"}
        stdin = body.get("stdin") or ""
        files = body.get("files") or None
        if files is not None and (not isinstance(files, dict) or len(files) > 20):
            return 400, {"error": "files must be an object of at most 20 entries"}
        try:
            timeout = float(body.get("timeout") or 8.0)
        except (TypeError, ValueError):
            timeout = 8.0
        timeout = max(0.5, min(timeout, 30.0))
        if mode == "repl":
            result = runner_mod.run_repl(code, stdin=stdin, files=files, timeout=timeout)
        else:
            result = runner_mod.run_python(code, stdin=stdin, files=files,
                                          timeout=timeout, mode="script")
        return 200, result.to_dict()

    def run_file(self, query, body):
        if runner_mod is None:
            return 503, {"error": "code runner unavailable", "detail": RUNNER_ERROR}
        name = body.get("name") or ""
        stdin = body.get("stdin") or ""
        result = runner_mod.run_file(name, stdin=stdin)
        return 200, result.to_dict()

    def sandbox(self, query, body):
        if runner_mod is None:
            return 503, {"error": "code runner unavailable", "detail": RUNNER_ERROR}
        return 200, runner_mod.sandbox_info()

    # ---- progress

    def progress(self, query, body):
        store = progress_mod.load()
        return 200, store

    def progress_set(self, query, body):
        return 200, progress_mod.update(body or {})

    def health(self, query, body):
        return 200, {
            "ok": True,
            "runner": runner_mod is not None,
            "runner_error": RUNNER_ERROR,
            "search": self.index() is not None,
            "search_error": self.search_error,
            "stats": read_json(os.path.join(DATA_DIR, "course.json"),
                               cache=True).get("stats", {}),
        }


def _code_kind(name):
    ext = os.path.splitext(name)[1].lower()
    return {
        ".py": "python", ".txt": "data", ".csv": "data", ".json": "data",
        ".html": "html", ".xml": "xml", ".sql": "sql", ".db": "database",
        ".zip": "archive",
    }.get(ext, "other")


API = Api()

ROUTES = [
    ("GET", re.compile(r"^/api/course$"), API.course),
    ("GET", re.compile(r"^/api/chapter/(?P<slug>[^/]+)$"), API.chapter),
    ("GET", re.compile(r"^/api/deck/(?P<slug>[^/]+)$"), API.deck),
    ("GET", re.compile(r"^/api/guide/(?P<slug>[^/]+)$"), API.guide),
    ("GET", re.compile(r"^/api/search$"), API.search_api),
    ("GET", re.compile(r"^/api/suggest$"), API.suggest),
    ("GET", re.compile(r"^/api/code$"), API.code_list),
    ("GET", re.compile(r"^/api/code/(?P<name>[^/]+)$"), API.code_one),
    ("GET", re.compile(r"^/api/sandbox$"), API.sandbox),
    ("GET", re.compile(r"^/api/progress$"), API.progress),
    ("POST", re.compile(r"^/api/progress$"), API.progress_set),
    ("POST", re.compile(r"^/api/run$"), API.run),
    ("POST", re.compile(r"^/api/run-file$"), API.run_file),
    ("GET", re.compile(r"^/api/health$"), API.health),
]


# ------------------------------------------------------------------ handler

class Handler(BaseHTTPRequestHandler):
    server_version = "py4e-offline/1.0"
    protocol_version = "HTTP/1.1"

    # -- helpers -----------------------------------------------------------

    def log_message(self, fmt, *args):
        if os.environ.get("PY4E_VERBOSE"):
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, status, ctype, payload, extra=None, head_only=False):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if not head_only:
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, status, obj, head_only=False):
        self._send(status, "application/json; charset=utf-8",
                   json.dumps(obj), head_only=head_only)

    def _serve_file(self, path, head_only=False, download_name=None):
        if not os.path.isfile(path):
            return False
        ctype = guess_type(path)
        # open before writing any header: once send_response has run we can no
        # longer answer with a clean 404/500
        try:
            fh = open(path, "rb")
            info = os.fstat(fh.fileno())
        except OSError:
            return False
        # media under static/ never changes once built, so it is safe to keep for
        # a week; the app's own JS/CSS is edited while the course is being worked
        # on, so it must be revalidated with a cheap 304 instead
        media = os.path.abspath(path).startswith(STATIC_DIR + os.sep)
        modified = self.date_time_string(info.st_mtime)
        with fh:
            if not media and not download_name \
                    and self.headers.get("If-Modified-Since") == modified:
                self.send_response(304)
                self.send_header("Last-Modified", modified)
                self.end_headers()
                return True
            try:
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(info.st_size))
                self.send_header("Last-Modified", modified)
                self.send_header("Cache-Control",
                                 "public, max-age=604800" if media else "no-cache")
                if download_name:
                    self.send_header("Content-Disposition",
                                     'attachment; filename="%s"' % download_name)
                self.end_headers()
            except (BrokenPipeError, ConnectionResetError):
                return True
            if not head_only:
                try:
                    while True:
                        chunk = fh.read(256 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        return True

    def _split(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        path = posixpath.normpath(path)
        if not path.startswith("/"):
            path = "/" + path
        return path, urllib.parse.parse_qs(parsed.query)

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if length <= 0:
            return {}
        if length > MAX_BODY:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    # -- dispatch ----------------------------------------------------------

    def do_GET(self):
        self._handle("GET")

    def do_HEAD(self):
        self._handle("GET", head_only=True)

    def do_POST(self):
        self._handle("POST")

    def _handle(self, method, head_only=False):
        path, query = self._split()

        for verb, pattern, handler in ROUTES:
            if verb != method:
                continue
            match = pattern.match(path)
            if not match:
                continue
            body = self._read_body() if method == "POST" else {}
            if body is None:
                return self._json(413, {"error": "request body too large"})
            try:
                status, payload = handler(query, body, **match.groupdict())
            except TypeError as exc:
                status, payload = 400, {"error": "bad request", "detail": str(exc)}
            except Exception as exc:  # noqa: BLE001
                status, payload = 500, {"error": "internal error", "detail": str(exc)}
            return self._json(status, payload, head_only=head_only)

        if method != "GET":
            return self._json(405, {"error": "method not allowed"})

        # static assets
        if path.startswith("/static/"):
            target = safe_join(STATIC_DIR, path[len("/static/"):])
            if not target:
                return self._json(403, {"error": "forbidden"})
            if self._serve_file(target, head_only=head_only):
                return
            return self._json(404, {"error": "not found", "path": path})

        if path.startswith("/assets/"):
            target = safe_join(WEB_DIR, path.lstrip("/"))
            if not target:
                return self._json(403, {"error": "forbidden"})
            if self._serve_file(target, head_only=head_only):
                return
            return self._json(404, {"error": "not found", "path": path})

        if path in ("/favicon.ico", "/apple-touch-icon.png"):
            target = safe_join(WEB_DIR, "assets", "img", path.lstrip("/"))
            if target and self._serve_file(target, head_only=head_only):
                return
            return self._send(204, "image/x-icon", b"")

        # anything else is a front-end route -> the SPA shell
        shell = os.path.join(WEB_DIR, "index.html")
        try:
            with open(shell, "r", encoding="utf-8") as fh:
                html = stamp_assets(fh.read())
        except OSError:
            return self._json(500, {"error": "web/index.html missing"})
        return self._send(200, "text/html; charset=utf-8", html, head_only=head_only)


def serve(host="127.0.0.1", port=8000, open_browser=False):
    os.makedirs(VAR_DIR, exist_ok=True)
    if not os.path.isdir(WEB_DIR):
        raise SystemExit("web/ directory missing next to server/")

    for attempt in range(20):
        try:
            httpd = ThreadingHTTPServer((host, port), Handler)
            break
        except OSError:
            port += 1
    else:
        raise SystemExit("no free port found")

    httpd.daemon_threads = True
    url = "http://%s:%d/" % (host if host != "0.0.0.0" else "localhost", port)
    stats = read_json(os.path.join(DATA_DIR, "course.json"), cache=True).get("stats", {})
    print("Python for Everybody — offline course", flush=True)
    print("  %d lessons · %d chapters · %d videos · %d slides · %d sample files · "
          "%d setup guides"
          % (stats.get("lessons", 0), stats.get("chapters", 0), stats.get("videos", 0),
             stats.get("slides", 0), stats.get("code_files", 0), stats.get("guides", 0)),
          flush=True)
    if RUNNER_ERROR:
        print("  ! code runner unavailable: %s" % RUNNER_ERROR, flush=True)
    print("  serving %s" % url, flush=True)
    print("  press Ctrl+C to stop", flush=True)
    if open_browser:
        import webbrowser
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Serve the offline PY4E course")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PY4E_PORT", 8000)))
    ap.add_argument("--host", default=os.environ.get("PY4E_HOST", "127.0.0.1"))
    ap.add_argument("--open", action="store_true", help="open a browser window")
    args = ap.parse_args()
    serve(args.host, args.port, args.open)
