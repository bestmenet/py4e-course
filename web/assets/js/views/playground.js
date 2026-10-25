/* views/playground.js — write and run Python against the course's own data
   files, in the browser, executed by Pyodide in a browser worker. */

import { el, icon, toast, copyText, store, fmtBytes, t } from '../core.js';
import { api } from '../api.js';
import { sitePath } from '../runtime.js';
import { state } from '../data.js';
import { renderFooter, crumbs } from '../components.js';

const DRAFT_KEY = 'playground-draft';

const STARTERS = [
  {
    id: 'hello',
    title: 'Hello, world',
    code: `print('Hello, world')\n`,
  },
  {
    id: 'files',
    title: 'Read a file',
    code: `# mbox.txt and the other course data files are already in the\n`
      + `# working directory, so this works with no setup.\n`
      + `handle = open('mbox.txt')\n`
      + `count = 0\n`
      + `for line in handle:\n`
      + `    if line.startswith('From:'):\n`
      + `        count = count + 1\n`
      + `print('From: lines in mbox.txt:', count)\n`,
  },
  {
    id: 'repl',
    mode: 'repl',
    title: 'Interactive session',
    code: `>>> d = dict()\n`
      + `>>> d['a'] = 1\n`
      + `>>> d['b'] = 2\n`
      + `>>> print(d)\n`
      + `>>> for key in d:\n`
      + `...     print(key, d[key])\n`
      + `... \n`,
  },
  {
    id: 'dict',
    title: 'Count words',
    code: `counts = dict()\n`
      + `for line in open('romeo.txt'):\n`
      + `    for word in line.split():\n`
      + `        counts[word] = counts.get(word, 0) + 1\n`
      + `\n`
      + `for word, n in sorted(counts.items(), key=lambda kv: -kv[1])[:10]:\n`
      + `    print(n, word)\n`,
  },
  {
    id: 'regex',
    title: 'Regular expressions',
    code: `import re\n`
      + `\n`
      + `text = 'From stephen.marquard@uct.ac.za Sat Jan  5 09:14:16 2008'\n`
      + `found = re.findall(r'\\S+@\\S+', text)\n`
      + `print(found)\n`
      + `print(re.search(r'^From (\\S+)', text).group(1))\n`,
  },
  {
    id: 'sqlite',
    title: 'A small database',
    code: `import sqlite3\n`
      + `\n`
      + `conn = sqlite3.connect(':memory:')\n`
      + `cur = conn.cursor()\n`
      + `cur.execute('''CREATE TABLE tracks (title TEXT, plays INTEGER)''')\n`
      + `cur.executemany('INSERT INTO tracks (title, plays) VALUES (?, ?)',\n`
      + `                [('Thunderstruck', 20), ('My Way', 15), ('Waltz', 3)])\n`
      + `conn.commit()\n`
      + `\n`
      + `for row in cur.execute('SELECT title, plays FROM tracks ORDER BY plays DESC'):\n`
      + `    print(row)\n`,
  },
  {
    id: 'url',
    title: 'Network request',
    code: `from pyodide.http import pyfetch\n`
      + `\n`
      + `# Fetch the course file from this site using the browser's network API.\n`
      + `response = await pyfetch('${sitePath('/static/code/romeo.txt')}')\n`
      + `if not response.ok:\n`
      + `    raise RuntimeError(f'HTTP {response.status}')\n`
      + `text = await response.string()\n`
      + `counts = dict()\n`
      + `for word in text.split():\n`
      + `    counts[word] = counts.get(word, 0) + 1\n`
      + `print(counts)\n`,
  },
];

export async function renderPlayground(view, params, query) {
  const saved = store.get(DRAFT_KEY);
  const sample = query.get('sample');
  let mode = saved?.mode === 'repl' ? 'repl' : 'script';
  const draft = typeof saved?.code === 'string' ? saved.code : STARTERS[0].code;

  const editor = el('textarea', {
    class: 'editor',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    'aria-label': 'Python source',
  });
  editor.value = draft;

  const gutter = el('div', { class: 'editor-gutter', 'aria-hidden': 'true' }, '1');
  const consoleOut = el('div', { class: 'console' });
  const stdinBox = el('textarea', {
    class: 'textarea',
    placeholder: 'Standard input, sent to your program line by line (optional)',
    style: { minHeight: '4.5rem', fontSize: 'var(--fs-xs)' },
    'aria-label': 'Standard input',
  });

  const runBtn = el('button', { class: 'btn btn-primary' }, icon('play', 15), 'Run');
  const stateLine = el('div', { class: 'meta-row' });

  const paintGutter = () => {
    const lines = editor.value.split('\n').length;
    const height = parseFloat(getComputedStyle(editor).lineHeight) || 21;
    const scroll = editor.scrollTop;
    gutter.style.transform = `translateY(${-scroll}px)`;
    gutter.replaceChildren(...Array.from({ length: lines }, (_, i) => el('div', {}, String(i + 1))));
    void height;
  };

  const saveDraft = () => {
    store.set(DRAFT_KEY, { code: editor.value, mode, at: Date.now() });
  };

  editor.addEventListener('input', () => { paintGutter(); saveDraft(); });
  editor.addEventListener('scroll', paintGutter);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value } = editor;
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        if (value.slice(lineStart, lineStart + 4) === '    ') {
          editor.value = value.slice(0, lineStart) + value.slice(lineStart + 4);
          editor.selectionStart = editor.selectionEnd = Math.max(lineStart, s - 4);
        }
      } else {
        editor.value = value.slice(0, s) + '    ' + value.slice(en);
        editor.selectionStart = editor.selectionEnd = s + 4;
      }
      paintGutter();
      saveDraft();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });

  async function run() {
    if (runBtn.disabled) return;
    const code = editor.value;
    if (!code.trim()) { toast('Nothing to run', '', 1400); return; }
    runBtn.disabled = true;
    runBtn.replaceChildren(el('span', { class: 'spinner' }), t('Running'));
    consoleOut.replaceChildren(el('span', { class: 'meta' }, t('Running…')));
    stateLine.replaceChildren();
    const started = performance.now();
    try {
      const result = await api.run({
        code,
        mode,
        stdin: stdinBox.value,
        timeout: 10,
      });
      renderConsole(consoleOut, result);
      stateLine.replaceChildren(
        el('span', { class: 'num' }, t('{ms} ms round trip', { ms: Math.round(performance.now() - started) })),
        el('span', { class: 'sep' }, '·'),
        el('span', {}, t('exit {code}', { code: result.exit_code === null ? '—' : result.exit_code })),
        ...(result.truncated ? [el('span', { class: 'badge badge-warm' }, 'output truncated')] : []));
    } catch (err) {
      consoleOut.replaceChildren(el('span', { class: 'err' },
        t('Could not start browser Python: {error}\n\nCheck your connection and try again.', { error: err.message })));
    } finally {
      runBtn.disabled = false;
      runBtn.replaceChildren(icon('play', 15), t('Run'));
    }
  }

  runBtn.addEventListener('click', run);

  /* ------------------------------------------------------------ the shell */

  const modeSwitch = el('div', { class: 'segmented' },
    ...[['script', 'Program'], ['repl', 'Interactive']].map(([key, label]) => el('button', {
      type: 'button',
      'aria-pressed': mode === key ? 'true' : 'false',
      dataset: { mode: key },
      onclick: () => setMode(key),
    }, label)));

  function setMode(nextMode) {
    mode = nextMode;
    for (const button of modeSwitch.children) {
      button.setAttribute('aria-pressed', button.dataset.mode === mode ? 'true' : 'false');
    }
    saveDraft();
  }

  const samples = el('select', {
    class: 'select',
    style: { width: 'auto' },
    'aria-label': 'Load a starter program',
    onchange: (e) => {
      const starter = STARTERS.find((s) => s.id === e.target.value);
      if (!starter) return;
      setMode(starter.mode || 'script');
      setCode(starter.code);
      toast(t('Loaded “{title}”', { title: t(starter.title) }), 'ok', 1500);
      e.target.selectedIndex = 0;
    },
  },
  el('option', { value: '' }, 'Load a starter…'),
  ...STARTERS.map((s) => el('option', { value: s.id }, s.title)));

  function setCode(code) { editor.value = code; paintGutter(); saveDraft(); }

  const toolbar = el('div', { class: 'panel-head', style: { gap: 'var(--s-3)', flexWrap: 'wrap' } },
    el('div', { class: 'row' },
      runBtn,
      el('span', { class: 'kbd' }, '⌘↵'),
      modeSwitch,
      samples),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn-quiet btn-sm',
        onclick: () => copyText(editor.value).then(() => toast('Copied', 'ok', 1300)),
      }, icon('copy', 14), 'Copy'),
      el('button', {
        class: 'btn btn-quiet btn-sm',
        onclick: () => {
          const blob = new Blob([editor.value], { type: 'text/x-python' });
          const a = el('a', { href: URL.createObjectURL(blob), download: 'myprogram.py' });
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        },
      }, icon('download', 14), 'Download'),
      el('button', {
        class: 'btn btn-quiet btn-sm',
        onclick: () => { setCode(''); editor.focus(); },
      }, icon('reset', 14), 'Clear')));

  const main = el('div', { class: 'playground' },
    toolbar,
    el('div', { class: 'editor-wrap' }, gutter, editor),
    el('div', {},
      el('div', {
        class: 'panel-head',
        style: { borderTop: '1px solid var(--line)' },
      },
      el('span', { class: 'lang', style: { fontSize: 'var(--fs-3xs)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' } },
        'Output'),
      stateLine),
      consoleOut));

  /* ---------------------------------------------------------------- aside */

  let files = [];
  try {
    const listing = await api.codeList();
    files = listing.files;
  } catch { /* the sidebar is optional */ }

  const fileSearch = el('input', {
    class: 'input', type: 'search', placeholder: 'Filter sample files…',
    style: { fontSize: 'var(--fs-xs)' },
  });
  const fileList = el('div', { class: 'lib-list', style: { maxHeight: '22rem' } });
  const paintFiles = (q = '') => {
    const needle = q.trim().toLowerCase();
    const shown = files.filter((f) => !needle || f.name.toLowerCase().includes(needle)).slice(0, 300);
    fileList.replaceChildren(...shown.map((f) => el('button', {
      class: 'lib-item',
      type: 'button',
      onclick: () => insertFileName(f.name),
    },
    el('span', { class: 'truncate' }, f.name),
    el('span', { class: 'sz' }, fmtBytes(f.bytes)))));
  };
  fileSearch.addEventListener('input', () => paintFiles(fileSearch.value));

  function insertFileName(name) {
    const literal = JSON.stringify(name);
    const { selectionStart: s, selectionEnd: e } = editor;
    editor.value = editor.value.slice(0, s) + literal + editor.value.slice(e);
    editor.selectionStart = editor.selectionEnd = s + literal.length;
    editor.focus();
    paintGutter();
    saveDraft();
  }

  paintFiles();

  const aside = el('aside', {},
    el('div', { class: 'panel', style: { marginBottom: 'var(--s-4)' } },
      el('div', { class: 'panel-head' },
        el('h4', {}, 'Standard input'),
        el('span', { class: 'muted', style: { fontSize: 'var(--fs-3xs)' } }, 'optional')),
      el('div', { class: 'panel-body' }, stdinBox)),
    el('div', { class: 'panel', style: { marginBottom: 'var(--s-4)' } },
      el('div', { class: 'panel-head' }, el('h4', {}, 'Data files')),
      el('div', { class: 'panel-body', style: { paddingBottom: 'var(--s-2)' } },
        fileSearch,
        el('p', { class: 'muted', style: { fontSize: 'var(--fs-3xs)', margin: 'var(--s-2) 0 0' } },
          t('Click a name to insert it at the cursor. All {count} files sit in the working directory.', { count: files.length }))),
      fileList),
    state.course ? el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h4', {}, 'Reference')),
      el('div', { class: 'panel-body' },
        el('div', { class: 'aside-list' },
          ...(state.course.chapters || []).slice(0, 16).map((c, i) => el('a', { href: `/read/${c.slug}` },
            el('span', { class: 'idx' }, String(i + 1)),
            el('span', { class: 'truncate' }, c.title)))))) : null);

  view.replaceChildren(
    el('div', { class: 'page' },
      crumbs([{ label: 'Overview', href: '/' }, { label: 'Playground' }]),
      el('div', { class: 'row-between wrap', style: { marginTop: 'var(--s-3)', marginBottom: 'var(--s-5)', gap: 'var(--s-4)' } },
        el('div', {},
          el('h1', {}, 'Playground'),
          el('p', { class: 'lede', style: { marginTop: 'var(--s-3)' } },
            t('Real Python, run in your browser. The first run loads the Python runtime. Course sample files are already in the working directory. Use pyodide.http.pyfetch with await for browser network requests; raw sockets and urllib networking are unavailable.'))),
        el('div', { class: 'row' },
          el('a', { class: 'btn btn-outline', href: '/library' }, icon('code', 15), 'Browse the library'))),
      el('div', { class: 'grid-split' }, main, aside)),
    renderFooter());

  paintGutter();
  if (sample) {
    try {
      const file = await api.codeFile(sample);
      setMode('script');
      editor.value = file.text;
      paintGutter();
      saveDraft();
    } catch (err) {
      toast(t('Could not load the example: {error}', { error: err.message }), '', 4000);
    }
  }
}

export function renderConsole(host, result) {
  host.replaceChildren();
  if (result.stdout) host.append(document.createTextNode(result.stdout.replace(/\n+$/, '\n')));
  if (result.stderr) {
    const error = el('span', { class: 'err' });
    error.append(document.createTextNode(result.stderr));
    host.append(error);
  }
  if (!result.stdout && !result.stderr) {
    host.append(el('span', { class: 'meta' }, result.ok ? '(no output)\n' : '(no output)'));
  }
  if (result.timed_out) {
    host.append(el('span', { class: 'meta' }, '\nStopped: the program ran longer than the time limit.'));
  }
}
