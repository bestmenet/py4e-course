# Python for Everybody — complete course website

The complete **Python for Everybody** course (Dr. Chuck / University of Michigan),
rebuilt as one complete website with a GitHub Pages edition.

**Live course: https://bestmenet.github.io/py4e-course/**

## GitHub Pages edition

Open the link above to read all 16 chapters, explore 17 lessons, view 629 slide
pages, watch the 87 embedded YouTube videos and browse 134 sample files. Search
runs in the browser with the same relevance ranking as the local edition.
Learning progress, notes, bookmarks and exercise results are saved in the current
browser and are not synced between devices.

Use the language switch to choose English or 简体中文. The Chinese edition covers
the interface, course titles and summaries; the original book text, slide images,
sample programs and videos remain in English.

Python examples run with a self-hosted Pyodide 314.0.7 runtime in a browser worker.
The first run downloads the runtime; later runs reuse it. Standard input, REPL
transcripts, SQLite and the course data files are available. Programs that use
raw sockets, desktop windows or unrestricted HTTP requests need a local Python installation;
browser network requests follow browser CORS and HTTPS restrictions.

To build the static edition:

```sh
python3 scripts/build_pages.py --base /py4e-course/
```

The dependency-free export creates `dist/`, including an entry point for every
course route so opening or refreshing a chapter URL works on Pages. The Actions
workflow `.github/workflows/pages.yml` builds and publishes each push to `main`.
Only `dist/` is deployed; no Python web server runs on GitHub Pages.

Pyodide comes from the official [314.0.7 release](https://github.com/pyodide/pyodide/releases/tag/314.0.7);
its licence is included under `web/assets/vendor/pyodide/`.

## Preview locally

```sh
python3 scripts/build_pages.py --base /
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Then open http://127.0.0.1:8000/. No npm install or server dependency is needed.
The Python runner also works in this local static preview.

## Validation

Check the bundled content and build the Pages edition:

```sh
python3 scripts/check_content.py
node scripts/check_js.mjs
python3 scripts/build_pages.py --base /py4e-course/
```

The content check validates local links, search anchors, slide resources and
sample files. It does not check whether external websites or videos are available.

To exercise Playground starters, saved drafts, standard input, errors and timeout
recovery, first start the local preview above. In another terminal, install the
locked test dependencies and run the browser check:

```sh
npm ci
PY4E_TEST_URL=http://127.0.0.1:8000/ node scripts/check_runner.mjs
PY4E_TEST_URL=http://127.0.0.1:8000/ node scripts/check_site.mjs
```

This check uses system Chromium at `/usr/bin/chromium`; set `CHROMIUM_PATH` to use
another installed Chromium executable. Browser Python cannot run raw sockets or
desktop GUI programs. Network examples require browser-compatible requests, HTTPS
and server CORS support; use a local Python installation for incompatible samples.
The site check visits every exported route in both languages and verifies language
switching, exercise completion, search, slide paging and mobile navigation. It
deliberately skips remote video requests and saves screenshots outside the checkout.

## Source layout

- `web/`: course interface, static data adapter, browser search, progress and Python worker.
- `data/`: complete structured course content, chapter bodies, slide metadata and search index.
- `static/`: original PDF/PPTX files, rendered slide pages, book figures and sample code.
- `scripts/build_pages.py`: reproducible static exporter and deep-link entry points.
- `_scrape/`: scripts and cached source pages used to assemble the course.
- `server/` and `run.py`: original local Python backend, retained for reference.
- `docs/ORIGINAL_README.md`: documentation of the original local server edition.

## Credits and licence

Course material is by **Dr. Charles R. Severance** (Dr. Chuck), published at
[py4e.com](https://www.py4e.com). This is an unofficial, non-commercial course
assembly. Original attribution and licence notices are retained in the content,
source files and original documentation. The book and website state
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/); some original
course resources carry earlier Creative Commons notices, which continue to apply
to those resources. See the notices in each original PDF/PPTX and sample file.

The original local-edition README is preserved in `docs/ORIGINAL_README.md`.
Pyodide and its bundled Python runtime retain their respective licences; see
`web/assets/vendor/pyodide/LICENSE` and the notices included in the runtime.
