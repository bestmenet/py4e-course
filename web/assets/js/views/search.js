import { sitePath } from '../runtime.js';
/* views/search.js — relevance-ranked search across the whole book. */

import { el, icon, navigate, debounce, titleCase } from '../core.js';
import { api } from '../api.js';
import { state, idx } from '../data.js';
import { renderFooter, crumbs, emptyState, sectionHead } from '../components.js';

export async function renderSearch(view, params, query) {
  const initial = query.get('q') || '';
  const chapterFilter = query.get('chapter') || '';
  let scope = chapterFilter ? [chapterFilter] : [];

  const input = el('input', {
    class: 'input',
    type: 'search',
    value: initial,
    placeholder: 'Search the book — try “open a file”, “re.findall”, “dictionary”',
    'aria-label': 'Search the book',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const results = el('div', {});
  const status = el('div', { class: 'filterbar' });
  const suggestions = el('div', { class: 'tag-list', style: { marginTop: 'var(--s-4)' } });

  const run = debounce(async (q) => {
    const term = q.trim();
    const url = term ? `/search?q=${encodeURIComponent(term)}${scope.length ? `&chapter=${scope[0]}` : ''}` : '/search';
    history.replaceState({}, '', sitePath(url));

    if (term.length < 2) {
      results.replaceChildren(hintBlock());
      status.replaceChildren();
      status.style.display = 'none';
      suggestions.replaceChildren();
      return;
    }

    status.style.display = '';
    status.replaceChildren(el('span', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } },
      el('span', { class: 'spinner' }), ' Searching…'));
    results.replaceChildren();

    try {
      const data = await api.search(term, { limit: 40, chapter: scope[0] || null });
      renderResults(term, data);
    } catch (err) {
      status.replaceChildren();
      results.replaceChildren(emptyState('Search is unavailable', err.message || String(err)));
    }
  }, 160);

  function renderResults(term, data) {
    status.style.display = '';
    status.replaceChildren(
      el('span', { style: { fontSize: 'var(--fs-sm)' } },
        el('strong', {}, String(data.count)),
        data.count === 1 ? ' result for ' : ' results for ',
        el('strong', {}, `“${term}”`)),
      el('span', { class: 'grow' }),
      scopeChips(),
      suggestions.childNodes.length ? null : null);

    if (!data.count) {
      results.replaceChildren(emptyState(
        'Nothing matched',
        `No part of the book contains “${term}”. Try a shorter query, or a term the book would use — `
        + 'like “list”, “socket” or “sqlite”.',
        el('button', {
          class: 'btn btn-outline', onclick: () => { input.value = ''; run(''); },
        }, 'Clear the search')));
      paintSuggestions(data.suggestions || []);
      return;
    }

    results.replaceChildren(
      ...data.results.map((hit) => resultRow(hit, term)));
    paintSuggestions(data.suggestions || []);
  }

  function scopeChips() {
    const chips = [el('button', {
      class: `pill ${scope.length ? '' : 'pill-accent'}`,
      type: 'button',
      onclick: () => { scope = []; run(input.value); },
    }, 'All chapters')];
    return el('div', { class: 'row', style: { gap: 'var(--s-1)' } }, ...chips);
  }

  function paintSuggestions(list) {
    suggestions.replaceChildren();
    if (!list.length) return;
    suggestions.append(el('span', { class: 'muted', style: { fontSize: 'var(--fs-2xs)', alignSelf: 'center' } },
      'Related terms:'));
    for (const term of list) {
      suggestions.append(el('button', {
        class: 'pill', type: 'button',
        onclick: () => { input.value = term; run(term); input.focus(); },
      }, term));
    }
  }

  function resultRow(hit, term) {
    const chapter = hit.chapter ? idx.chapterBySlug.get(hit.chapter) : null;
    const guide = hit.guide
      ? (state.course.guides || []).find((g) => g.slug === hit.guide) : null;
    const href = hit.is_lesson
      ? `/lesson/${hit.anchor}`
      : guide
        ? `/setup/${hit.guide}${hit.anchor ? `#${hit.anchor}` : ''}`
        : `/read/${hit.chapter}${hit.anchor ? `#${hit.anchor}` : ''}`;
    const where = hit.is_lesson
      ? 'Lesson overview'
      : guide
        ? `Setup · ${guide.label}`
        : `Chapter ${chapterNumber(hit.chapter)} · ${chapter ? chapter.title : hit.chapter}`;

    return el('div', { class: 'result' },
      el('div', { class: 'where' }, where),
      el('h3', {}, el('a', { href, html: hit.title_html })),
      el('div', { class: 'snippet', html: hit.snippet }));
  }

  function hintBlock() {
    const popular = ['dictionary', 'list methods', 'opening files', 'regular expressions',
      'socket', 'BeautifulSoup', 'sqlite', 'for loop', 'try except', 'json'];
    return el('div', { style: { paddingTop: 'var(--s-6)' } },
      el('h2', { class: 'section-title' }, 'Search the entire book'),
      el('p', { class: 'lede', style: { marginBottom: 'var(--s-5)' } },
        'Every word of the book, every lesson description and video title, and the installation '
        + 'guides — indexed in your browser. Results are ranked so the section that actually '
        + 'explains a term comes first.'),
      el('div', { class: 'tag-list' }, ...popular.map((p) => el('button', {
        class: 'pill', type: 'button',
        onclick: () => { input.value = p; run(p); input.focus(); },
      }, p))));
  }

  const form = el('form', {
    class: 'search-big',
    onsubmit: (e) => { e.preventDefault(); run(input.value); },
  },
  el('div', { class: 'searchbox grow' }, icon('search'), input),
  el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Search'));

  input.addEventListener('input', () => run(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });

  view.replaceChildren(
    el('div', { class: 'search-hero' },
      crumbs([{ label: 'Overview', href: '/' }, { label: 'Search' }]),
      el('h1', { style: { marginTop: 'var(--s-3)' } }, 'Search'),
      form,
      suggestions),
    el('div', { class: 'page page-narrow', style: { paddingTop: 0 } },
      status,
      results),
    renderFooter());

  if (initial.length >= 2) run(initial);
  else results.replaceChildren(hintBlock());
  status.style.display = initial.length >= 2 ? '' : 'none';
  setTimeout(() => input.focus(), 60);
}

function chapterNumber(slug) {
  const i = state.course.chapters.findIndex((c) => c.slug === slug);
  return i >= 0 ? i + 1 : '·';
}
