# Python for Everybody — an offline course

The complete **Python for Everybody** course (Dr. Chuck / University of Michigan),
rebuilt as one self-contained website that runs on your own machine.

Everything the original course spreads across a dozen pages — the book, the lecture
videos, the slides, the sample code and the setup guides — is assembled here into a
single site with one navigation, one design, and no downloads along the way.

```
python3 run.py           # then open http://127.0.0.1:8000
python3 run.py --open    # ...and open a browser window for you
```

No `pip install`, no virtualenv, no build step. Python 3.8+ and the standard library
are all it needs.

## What is inside

| | |
|---|---|
| **Lessons** | 17, in course order, each with its videos, slides, chapter and exercises |
| **Chapters** | the complete 16-chapter book, 59,600 words, as HTML you can read here |
| **Videos** | 87 lecture videos, ~14.5 hours, embedded from YouTube |
| **Slides** | 629 rendered pages across 16 decks, plus the original PDF/PPTX to download |
| **Sample code** | 134 files from `py4e.com/code3`, runnable in the browser |
| **Setup guides** | 5 installation guides, rebuilt as local pages |
| **Search** | every word above, ranked locally — no search engine involved |

### Everything is a page, not a download

The point of the original course is that the material is scattered: a PDF here, a
YouTube link there, a `.zip` of sample files somewhere else. Here each of those is
content on the site:

- **The book** (`/read/<chapter>`) is the full text with working figures, syntax-
  highlighted code, a table of contents and keyboard-driven reading.
- **The slides** (`/slides/<deck>`) are every page of every deck, rendered to images
  with the original title, bullets and speaker notes extracted from the `.pptx`
  underneath, in a paging viewer.
- **The videos** (`/videos`) are embedded players, grouped by lesson, with the
  durations and watch progress tracked.
- **The code** (`/library`) is every sample file, shown with syntax highlighting and
  a **Run** button — and the data files the book's programs read (`mbox.txt`,
  `romeo.txt`, `words.py`, …) are there too, so `open('mbox.txt')` actually works.
- **The setup guides** (`/setup`) are lesson 1's real content: install Python on
  macOS, Windows or Replit, choose an editor, and see what the first assignment is.

### The code actually runs

`/playground` and every code block in the book run on the Python interpreter already
on your machine, through a small local sandbox:

- each run gets a fresh temporary directory with the sample data files symlinked in,
  so a program that writes a file cannot touch your project;
- the interpreter runs with `-I` (isolated: no site packages, no `PYTHONPATH`,
  no user site directory);
- runs are killed after a timeout, in their own process group, and output is capped;
- REPL transcripts (`>>>`-style listings) are replayed line by line, so the book's
  interactive examples produce the same session they printed.

This is a convenience sandbox for learning, **not a security boundary** — it runs code
you type, on your machine. It is only exposed on `127.0.0.1`.

### Offline

The site, its content, the slides, the images and the sample data are all local, so
everything except the videos works with the network off. The 87 lecture videos are
embedded from YouTube and therefore need a connection; each one also links out to its
original page.

## Layout

```
run.py                 start the server
server/                the standard-library backend
  app.py               HTTP routing, static files, JSON API
  search.py            BM25 ranking with stemming and phrase boosts
  progress.py          your progress, in var/progress.json
  runner.py            the Python sandbox
web/                   the front end: ES modules, no bundler
  index.html
  assets/css/          theme tokens, components, views
  assets/js/           core, api, data, highlight, components, app + views/
data/                  the course model, built by _scrape/
  course.json          all 17 lessons, chapter/deck indexes, guides
  search.json          219 ranked documents
  chapters/*.json      chapter bodies, one file each
  decks/*.json         slide decks, one file each
  guides/*.json        setup guides, one file each
static/                media, ~104 MB
  slides/downloads/    the original PDF and PPTX for every deck
  slides/<deck>/       the rendered slide pages (WebP)
  images/ photos/      the book's figures
  code/                every sample file, including the data files
_scrape/               the tooling that built data/ from py4e.com
var/progress.json      your progress (created on first run)
```

The front end loads `course.json` once and then fetches chapter and deck bodies on
demand, which is why the reader is instant even though the book is 59,600 words.

## Rebuilding from source

`data/` was produced by the scripts in `_scrape/`, which need a handful of packages
(`requests`, `beautifulsoup4`, `lxml`, `pymupdf`, `python-pptx` — there is a venv in
`_scrape/venv`). They are **not** needed to run the course, only to rebuild it:

```
_scrape/venv/bin/python _scrape/scrape.py          # inventory every lesson and chapter
_scrape/venv/bin/python _scrape/download.py        # fetch 199 assets
_scrape/venv/bin/python _scrape/render_slides.py   # render 629 slide pages to WebP
_scrape/venv/bin/python _scrape/build_guides.py    # the setup guides
_scrape/venv/bin/python _scrape/build_content.py   # build data/course.json + search.json
```

Verification helpers used while building it:

```
python3 _scrape/checkimports.py                    # every ES import resolves
node --experimental-vm-modules _scrape/checkmjs.mjs web/assets/js/*.js   # parse check
node _scrape/domtest.mjs http://127.0.0.1:8000     # render every route in jsdom
node _scrape/playtest.mjs http://127.0.0.1:8000    # editor, stdin, REPL, run-a-file
```

## Credits and licence

All course material — the book, the slides, the videos, the sample code and the
setup guides — is by **Dr. Charles R. Severance** ("Dr. Chuck") and is published at
[py4e.com](https://www.py4e.com) under
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). It is
reproduced here, unchanged in substance, for personal study; the non-commercial and
share-alike terms carry over to anything you build from it.

This site is an unofficial offline assembly of that material. The code that does the
assembling — the server, the front end and the build scripts in `_scrape/` — is
original work and is provided as-is, for study.
