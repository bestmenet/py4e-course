import { sitePath } from '../runtime.js';
/* views/library.js — every sample program and data file the book references,
   browsable and runnable in place. */

import { el, icon, fmtBytes, navigate, toast, copyText, debounce, store } from '../core.js';
import { highlight } from '../highlight.js';
import { api } from '../api.js';
import { state } from '../data.js';
import { renderFooter, crumbs, emptyState, sectionHead } from '../components.js';

/** Which chapter each sample belongs to, inferred from the book's links.
    Anything unmatched falls into "General". */
const GROUPS = [
  { id: 'python', label: 'Programs', match: (n) => n.endsWith('.py') },
  { id: 'data', label: 'Data files', match: (n) => /\.(txt|csv|json|xml|db)$/.test(n) },
  { id: 'markup', label: 'Markup', match: (n) => /\.(html|htm)$/.test(n) },
  { id: 'archive', label: 'Archives', match: (n) => /\.zip$/.test(n) },
];

export async function renderLibrary(view, params, query) {
  let listing;
  try {
    listing = await api.codeList();
  } catch (err) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('The code library is unavailable', err.message || String(err))),
      renderFooter());
    return;
  }

  const files = listing.files;
  const wanted = query.get('f');
  const group = query.get('group') || 'all';
  let query_ = query.get('q') || '';

  const list = el('div', { class: 'lib-list' });
  const pane = el('div', {});
  const search = el('input', {
    class: 'input', type: 'search', value: query_,
    placeholder: 'Filter by name…', style: { fontSize: 'var(--fs-xs)' },
  });

  const groupChips = el('div', { class: 'segmented' },
    ...[['all', `All ${files.length}`], ...GROUPS.map((g) => [
      g.id, `${g.label} ${files.filter((f) => g.match(f.name)).length}`,
    ])].map(([id, label]) => el('button', {
      type: 'button',
      'aria-pressed': group === id ? 'true' : 'false',
      onclick: () => { navigate(`/library?group=${id}`, { keepScroll: true }); },
    }, label)));

  function visible() {
    const needle = query_.trim().toLowerCase();
    const g = GROUPS.find((x) => x.id === group);
    return files.filter((f) => (!g || g.match(f.name))
      && (!needle || f.name.toLowerCase().includes(needle)));
  }

  function paintList() {
    const shown = visible();
    if (!shown.length) {
      list.replaceChildren(el('div', { class: 'empty', style: { padding: 'var(--s-6)' } },
        el('p', { style: { fontSize: 'var(--fs-sm)' } }, 'No files match.')));
      return;
    }
    list.replaceChildren(...shown.map((f) => el('button', {
      class: 'lib-item',
      type: 'button',
      'aria-current': f.name === currentName ? 'true' : null,
      onclick: () => open(f.name),
    },
    el('span', { class: 'truncate' }, f.name),
    el('span', { class: 'sz' }, fmtBytes(f.bytes)))));
  }

  let currentName = null;

  async function open(name) {
    currentName = name;
    paintList();
    history.replaceState({}, '', sitePath(`/library?f=${encodeURIComponent(name)}${group !== 'all' ? `&group=${group}` : ''}`));
    pane.replaceChildren(el('div', { class: 'skeleton', style: { height: '20rem' } }));
    try {
      const file = await api.codeFile(name);
      pane.replaceChildren(fileView(file));
    } catch (err) {
      pane.replaceChildren(emptyState('Could not open this file', err.message || String(err)));
    }
  }

  function fileView(file) {
    const isText = file.kind !== 'archive' && file.kind !== 'database';
    const isPython = file.name.endsWith('.py');

    const codeEl = el('code', {
      html: isText ? highlight(file.text, file.kind === 'python' ? 'python'
        : file.kind === 'html' ? 'html'
          : file.kind === 'xml' ? 'xml'
            : file.kind === 'json' ? 'json' : 'text') : '',
    });

    const output = el('div', { class: 'runner-out', dataset: { open: '0' } });

    // several of the book's programs call input(); give them something to read
    const stdinBox = el('textarea', {
      class: 'textarea',
      placeholder: 'Standard input — e.g. mbox.txt or romeo.txt',
      style: { minHeight: '3.5rem', fontSize: 'var(--fs-xs)', margin: 0 },
      'aria-label': `Standard input for ${file.name}`,
    });
    const stdinRow = el('div', {
      style: {
        display: 'none', padding: 'var(--s-3) var(--s-4)',
        borderTop: '1px solid var(--code-line)', background: 'var(--surface-alt)',
      },
    },
    el('label', {
      style: {
        display: 'block', fontSize: 'var(--fs-3xs)', fontWeight: '640',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--ink-4)', marginBottom: 'var(--s-2)',
      },
    }, 'Standard input (one value per line)'),
    stdinBox);

    const runBtn = el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        stdinRow.style.display = '';
        output.dataset.open = '1';
        output.replaceChildren(el('span', { class: 'out-label' }, 'Running…'));
        try {
          const result = await api.runFile(file.name, stdinBox.value);
          output.replaceChildren(el('span', { class: 'out-label' }, 'Output'));
          if (result.stdout) output.append(document.createTextNode(result.stdout));
          if (result.stderr) output.append(el('span', { class: 'err' }, result.stderr));
          if (!result.stdout && !result.stderr) output.append(el('span', { class: 'meta' }, '(no output)'));
          output.append(el('span', { class: 'meta' }, `\n— ${result.duration_ms} ms`));
          // if the program wanted input and got none, open the input box for them
          if (/EOFError/.test(result.stderr || '')) {
            stdinBox.focus();
            output.append(el('span', { class: 'meta' },
              '\nThis program asks for input — type an answer above, then run it again.'));
          }
        } catch (err) {
          output.replaceChildren(el('span', { class: 'err' }, `Runner unavailable: ${err.message}`));
        }
      },
    }, icon('play', 13), 'Run this program');

    const head = el('div', { class: 'panel-head', style: { flexWrap: 'wrap', gap: 'var(--s-3)' } },
      el('div', { class: 'row' },
        el('span', { class: 'mono', style: { fontSize: 'var(--fs-sm)', fontWeight: '600' } }, file.name),
        el('span', { class: 'badge badge-plain' }, file.kind),
        el('span', { class: 'muted num', style: { fontSize: 'var(--fs-3xs)' } }, fmtBytes(file.bytes))),
      el('div', { class: 'row' },
        file.runnable ? runBtn : null,
        file.runnable ? el('a', {
          class: 'btn btn-outline btn-sm',
          href: `/playground?sample=${encodeURIComponent(file.name)}`,
        }, icon('terminal', 13), 'Edit in playground') : null,
        el('button', {
          class: 'btn btn-quiet btn-sm',
          onclick: () => copyText(file.text).then(() => toast('Copied', 'ok', 1300)),
        }, icon('copy', 14)),
        el('a', {
          class: 'btn btn-quiet btn-sm', href: `/static/code/${file.name}`, download: '',
        }, icon('download', 14))));

    const body = isText
      ? el('div', { class: 'codeblock', style: { margin: 0, border: 0, borderRadius: 0 } },
          el('pre', { style: { maxHeight: '34rem' } }, codeEl))
      : el('div', { class: 'panel-body' },
          el('div', { class: 'callout' },
            icon('info', 18),
            el('div', {}, `This is a ${file.kind} file and cannot be shown as text. Download it to inspect it.`)));

    return el('div', { class: 'panel' }, head, body, stdinRow, output);
  }

  search.addEventListener('input', debounce(() => {
    query_ = search.value;
    paintList();
  }, 150));

  paintList();

  const aside = el('div', {},
    el('div', { class: 'panel', style: { marginBottom: 'var(--s-4)' } },
      el('div', { class: 'panel-body', style: { paddingBottom: 'var(--s-2)' } },
        search,
        el('p', { class: 'muted', style: { fontSize: 'var(--fs-3xs)', margin: 'var(--s-3) 0 0' } },
          'These are the exact files the book’s programs read. They live in the working '
          + 'directory of the playground and the runner.'))),
    el('div', { class: 'panel' }, list));

  view.replaceChildren(
    el('div', { class: 'page' },
      crumbs([{ label: 'Overview', href: '/' }, { label: 'Code library' }]),
      el('div', { class: 'row-between wrap', style: { marginTop: 'var(--s-3)', marginBottom: 'var(--s-5)', gap: 'var(--s-4)' } },
        el('div', {},
          el('h1', {}, 'Code library'),
          el('p', { class: 'lede', style: { marginTop: 'var(--s-3)' } },
            `${files.length} programs and data files, downloaded from the course and available here. `
            + 'Every Python file can be run here, unchanged.')),
        el('div', { class: 'row' }, groupChips)),
      el('div', { class: 'lib-layout' }, aside, pane)),
    renderFooter());

  // open the requested file, or the first program in the current filter
  const initial = wanted || (visible()[0] && visible()[0].name);
  if (initial) open(initial);
  else pane.replaceChildren(emptyState('Pick a file', 'Choose something from the list on the left.'));
}
