/* app.js — bootstrap: build the shell, load the course, run the router. */

import {
  el, route, setNotFound, startRouter, mountReadBar, onRouteChange,
  toast, initTheme, navigate,
  t,
} from './core.js';
import { state, loadCourse, loadProgress, subscribe } from './data.js';
import { shell, renderTopbar, renderFooter, emptyState } from './components.js';

initTheme();

const { app, topbar, view } = shell();

/* ---------------------------------------------------------------- views */

const views = {};
const loaders = {
  home: () => import('./views/home.js'),
  syllabus: () => import('./views/syllabus.js'),
  setup: () => import('./views/setup.js'),
  lesson: () => import('./views/lesson.js'),
  read: () => import('./views/read.js'),
  book: () => import('./views/book.js'),
  videos: () => import('./views/videos.js'),
  slides: () => import('./views/slides.js'),
  library: () => import('./views/library.js'),
  playground: () => import('./views/playground.js'),
  search: () => import('./views/search.js'),
  progress: () => import('./views/progress.js'),
};

async function viewModule(name) {
  if (!views[name]) views[name] = await loaders[name]();
  return views[name];
}

/* --------------------------------------------------------------- routing */

/** Each entry: [path pattern, view module, exported function, topbar href] */
const ROUTES = [
  ['/', 'home', 'renderHome', '/'],
  ['/syllabus', 'syllabus', 'renderSyllabus', '/syllabus'],
  ['/setup', 'setup', 'renderSetup', '/setup'],
  ['/setup/:slug', 'setup', 'renderSetupGuide', '/setup'],
  ['/lesson/:slug', 'lesson', 'renderLesson', '/syllabus'],
  ['/read/:slug', 'read', 'renderRead', '/book'],
  ['/read', 'book', 'renderBook', '/book'],
  ['/book', 'book', 'renderBook', '/book'],
  ['/videos', 'videos', 'renderVideos', '/videos'],
  ['/slides', 'slides', 'renderSlides', '/slides'],
  ['/slides/:slug', 'slides', 'renderDeck', '/slides'],
  ['/library', 'library', 'renderLibrary', '/library'],
  ['/playground', 'playground', 'renderPlayground', '/playground'],
  ['/search', 'search', 'renderSearch', '/search'],
  ['/progress', 'progress', 'renderProgress', '/progress'],
];

for (const [pattern, moduleName, fnName, navHref] of ROUTES) {
  route(pattern, async (params, query) => {
    renderTopbar(navHref);
    document.dispatchEvent(new CustomEvent('viewchange'));
    view.classList.remove('view-enter');
    try {
      const mod = await viewModule(moduleName);
      await mod[fnName](view, params, query);
    } catch (err) {
      console.error(err);
      view.replaceChildren(
        el('div', { class: 'page page-narrow' },
          emptyState('Something went wrong', err.message || String(err),
            el('button', {
              class: 'btn btn-primary', onclick: () => location.reload(),
            }, 'Reload the page')),
          renderFooter()));
    }
    // eslint-disable-next-line no-unused-expressions
    void view.offsetWidth;   // force a reflow so the enter animation replays
    view.classList.add('view-enter');
    setMeta(moduleName, params);
  });
}

setNotFound((path) => {
  renderTopbar(null);
  view.replaceChildren(
    el('div', { class: 'page page-narrow', style: { paddingTop: 'var(--s-10)' } },
      el('p', { class: 'eyebrow', style: { marginBottom: 'var(--s-4)' } }, '404'),
      el('h1', {}, 'That page does not exist'),
      el('p', { class: 'lede', style: { marginTop: 'var(--s-4)' } },
        t('Nothing lives at {path}. The course has a fixed set of pages — try the syllabus.', { path })),
      el('div', { class: 'row', style: { marginTop: 'var(--s-6)' } },
        el('a', { class: 'btn btn-primary', href: '/' }, 'Overview'),
        el('a', { class: 'btn btn-outline', href: '/syllabus' }, 'Syllabus')),
      renderFooter()));
});

function setMeta(moduleName, params) {
  const base = t('Python for Everybody');
  const titles = {
    home: base,
    syllabus: `${t('Syllabus')} · ${base}`,
    setup: `${t('Setup')} · ${base}`,
    lesson: `${t('Lesson')} · ${base}`,
    read: `${t('Read the book')} · ${base}`,
    book: `${t('The book')} · ${base}`,
    videos: `${t('Videos')} · ${base}`,
    slides: `${t('Slides')} · ${base}`,
    library: `${t('Code library')} · ${base}`,
    playground: `${t('Playground')} · ${base}`,
    search: `${t('Search')} · ${base}`,
    progress: `${t('My progress')} · ${base}`,
  };
  document.title = titles[moduleName] || base;
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.content = t('The complete PY4E course materials — book, lecture videos, slides and sample code — in one offline site.');
  }
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const bootNode = document.getElementById('boot');
  try {
    await loadCourse();
  } catch (err) {
    if (bootNode) {
      bootNode.replaceChildren(el('div', { style: { maxWidth: '34rem', padding: '2rem', textAlign: 'center' } },
        el('h1', { style: { fontSize: '1.3rem', marginBottom: '0.75rem' } }, 'The course could not load'),
        el('p', { style: { color: 'var(--ink-3)', fontSize: '0.9rem', marginBottom: '1rem' } },
          'Check your connection and reload the page.'),
        el('p', { style: { color: 'var(--ink-4)', fontSize: '0.8rem' } },
          err.message || String(err))));
    }
    return;
  }

  document.body.replaceChildren(app);
  mountReadBar();
  loadProgress();          // deliberately not awaited: the UI paints first

  onRouteChange(() => { /* reserved for analytics or scroll restoration hooks */ });
  startRouter();

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;
    if (e.key === '/') {
      e.preventDefault();
      const input = document.querySelector('.searchbox .input');
      if (input) input.focus();
      else navigate('/search');
    }
    if (e.key === 'g') {
      const next = (ev) => {
        document.removeEventListener('keydown', next);
        const map = { h: '/', s: '/syllabus', b: '/book', v: '/videos', c: '/library', p: '/playground' };
        if (map[ev.key]) navigate(map[ev.key]);
      };
      document.addEventListener('keydown', next, { once: true });
    }
  });

  // surface the runner's availability once, quietly
  import('./api.js').then(({ api }) => api.health()).then((h) => {
    state.runnerReady = !!h.runner;
    if (!h.runner && h.runner_error) {
      toast('Code execution is unavailable — samples will show but not run.', '', 4200);
    }
  }).catch(() => { /* the server is up; health is optional */ });
}

boot();
