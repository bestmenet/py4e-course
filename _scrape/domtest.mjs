console.log('HARNESS START');



/* Run every view in a jsdom document against the live server and report
   runtime errors, missing elements and broken navigation.

   Usage: node _scrape/domtest.mjs [base-url] [url...] */
import { JSDOM } from 'jsdom';

const BASE = process.argv[2] || 'http://127.0.0.1:8765';
const VIEWS = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['/', '/syllabus', '/setup', '/setup/mac', '/setup/windows', '/setup/nope',
     '/lesson/install', '/lesson/install?tab=setup', '/lesson/intro', '/lesson/files',
     '/lesson/dataviz', '/read/01-intro', '/read/07-files', '/book',
     '/videos', '/slides', '/slides/15-databases', '/library',
     '/playground', '/search?q=dictionary', '/progress', '/nope'];

const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="boot"></div></body></html>`, {
  url: BASE + '/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;

/* ---- browser surface the app expects -------------------------------- */
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator, configurable: true, writable: true,
});
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.localStorage = window.localStorage;
globalThis.CustomEvent = window.CustomEvent;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.performance = window.performance;
window.matchMedia = window.matchMedia || ((q) => ({
  matches: false, media: q, addEventListener() {}, removeEventListener() {},
}));
window.scrollTo = () => {};
Element.prototype.scrollIntoView = function () {};
window.requestIdleCallback = (fn) => setTimeout(fn, 0);

/* jsdom installs a performance object with no markResourceTiming, which makes
   Node's own fetch blow up; restore a minimal one before any request runs. */
globalThis.performance = {
  now: () => Number(process.hrtime.bigint() / 1000n) / 1000,
  markResourceTiming() {},
  getEntriesByName: () => [],
  getEntries: () => [],
  timeOrigin: Date.now(),
};
window.performance = globalThis.performance;

const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(url.startsWith('http') ? url : BASE + url, { ...opts, keepalive: false });
window.fetch = globalThis.fetch;

/* ---- error capture --------------------------------------------------- */
const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
window.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + e.reason));
const origError = console.error;
console.error = (...args) => { errors.push('console.error: ' + args.join(' ')); };

/* ---- run ------------------------------------------------------------- */
const results = [];
const t = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle() {
  // give dynamic imports, fetches and timers room to finish
  await t(700);
}

async function main() {
  const core = await import('../web/assets/js/core.js');
  const data = await import('../web/assets/js/data.js');
  const components = await import('../web/assets/js/components.js');

  await data.loadCourse();
  await data.loadProgress();

  const mods = {};
  const need = {
    home: ['home'], syllabus: ['syllabus'], lesson: ['lesson'], read: ['read'],
    book: ['book'], videos: ['videos'], slides: ['slides'], library: ['library'],
    playground: ['playground'], search: ['search'], progress: ['progress'],
    setup: ['setup'],
  };
  for (const [name, files] of Object.entries(need)) {
    for (const f of files) mods[f] = await import(`../web/assets/js/views/${f}.js`);
  }

  const { shell } = components;
  const { view } = shell();
  document.body.append(view);

  const PLAN = {
    '/': ['home', 'renderHome'],
    '/syllabus': ['syllabus', 'renderSyllabus'],
    '/setup': ['setup', 'renderSetup'],
    '/setup/mac': ['setup', 'renderSetupGuide'],
    '/setup/windows': ['setup', 'renderSetupGuide'],
    '/setup/nope': ['setup', 'renderSetupGuide'],
    '/lesson/install': ['lesson', 'renderLesson'],
    '/lesson/install?tab=setup': ['lesson', 'renderLesson'],
    '/lesson/intro': ['lesson', 'renderLesson'],
    '/lesson/files': ['lesson', 'renderLesson'],
    '/lesson/files?tab=videos': ['lesson', 'renderLesson'],
    '/lesson/files?tab=slides': ['lesson', 'renderLesson'],
    '/lesson/files?tab=reading': ['lesson', 'renderLesson'],
    '/lesson/files?tab=practice': ['lesson', 'renderLesson'],
    '/lesson/dataviz': ['lesson', 'renderLesson'],
    '/read/01-intro': ['read', 'renderRead'],
    '/read/07-files': ['read', 'renderRead'],
    '/book': ['book', 'renderBook'],
    '/videos': ['videos', 'renderVideos'],
    '/slides': ['slides', 'renderSlides'],
    '/slides/15-databases': ['slides', 'renderDeck'],
    '/library': ['library', 'renderLibrary'],
    '/playground': ['playground', 'renderPlayground'],
    '/search?q=dictionary': ['search', 'renderSearch'],
    '/search?q=regex%20findall': ['search', 'renderSearch'],
    '/progress': ['progress', 'renderProgress'],
    '/nope': null,
  };

  console.log('walking views:', VIEWS.join(' '));
  for (const url of VIEWS) {
    const plan = PLAN[url];
    errors.length = 0;
    let note = '';
    try {
      view.replaceChildren();
      if (!plan) {
        view.append(core.el('p', {}, 'not found'));
        note = 'not-found route';
      } else {
        const [file, fn] = plan;
        const params = {};
        const u = new URL(url, BASE);
        window.document.dispatchEvent(new window.CustomEvent('viewchange'));
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] === 'lesson') params.slug = parts[1];
        if (parts[0] === 'read') params.slug = parts[1];
        if (parts[0] === 'setup' && parts[1]) params.slug = parts[1];
        if (parts[0] === 'slides' && parts[1]) params.slug = parts[1];
        await mods[file][fn](view, params, u.searchParams);
        await settle();
      }
      const html = view.innerHTML;
      const text = view.textContent || '';
      results.push({
        url,
        ok: errors.length === 0,
        errors: [...errors],
        nodes: view.querySelectorAll('*').length,
        textLen: text.trim().length,
        chars: html.length,
        h1: (view.querySelector('h1') || {}).textContent || '',
        note,
      });
    } catch (err) {
      results.push({
        url, ok: false, errors: [...errors, 'THROWN: ' + (err && err.stack || err)],
        nodes: 0, textLen: 0, chars: 0, h1: '', note,
      });
    }
  }

  /* ---- deep checks on a few pages -------------------------------------- */
  const checks = [];
  const check = (name, cond, detail) => checks.push({ name, ok: !!cond, detail: detail || '' });

  // the router announces every transition with `viewchange`; views use it to
  // drop their store subscriptions, so the harness must announce one too
  const go = (file, fn, params = {}, q = '') => {
    window.document.dispatchEvent(new window.CustomEvent('viewchange'));
    return mods[file][fn](view, params, new URLSearchParams(q));
  };

  // home
  await go('home', 'renderHome', {});
  check('home has 17 lesson cards', view.querySelectorAll('.lesson-card').length === 17,
    String(view.querySelectorAll('.lesson-card').length));
  check('home has stat strip', view.querySelectorAll('.stat').length === 6);
  check('home hero h1', /solving problems/.test(view.querySelector('h1')?.textContent || ''));

  // reader
  await go('read', 'renderRead', { slug: '07-files' });
  await settle();
  const book = view.querySelector('.book');
  check('reader renders the chapter body', book && book.textContent.length > 4000,
    String(book?.textContent.length));
  check('reader upgraded <pre> to interactive codeblocks',
    view.querySelectorAll('.codeblock').length > 10,
    String(view.querySelectorAll('.codeblock').length));
  check('reader emits syntax spans',
    view.querySelectorAll('.tok-k').length > 10 && view.querySelectorAll('.tok-s').length > 10,
    `kw=${view.querySelectorAll('.tok-k').length} str=${view.querySelectorAll('.tok-s').length}`);
  check('reader detects REPL prompts', view.querySelectorAll('.prompt').length > 5,
    String(view.querySelectorAll('.prompt').length));
  check('reader has chapter nav', view.querySelectorAll('.chapter-list a').length === 16,
    String(view.querySelectorAll('.chapter-list a').length));
  check('reader has on-this-page nav', view.querySelectorAll('.onthispage-list a').length > 5,
    String(view.querySelectorAll('.onthispage-list a').length));
  check('reader images point at /static', !view.querySelector('.book img[src^="../"]'),
    String(view.querySelector('.book img')?.getAttribute('src')));

  // run a sample through the live server
  const pre = [...view.querySelectorAll('.codeblock')].find((b) => b.dataset.kind === 'repl');
  if (pre) {
    const runBtn = [...pre.querySelectorAll('button')].find((b) => /Run/.test(b.textContent));
    runBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await t(1600);
    const out = pre.querySelector('.runner-out');
    check('sample code actually executes', out && out.textContent.length > 4,
      (out?.textContent || '').slice(0, 120));
    check('sample output rendered without a crash', !/Could not run/.test(out?.textContent || ''),
      out?.textContent?.slice(0, 120));
  } else {
    check('found a runnable sample', false, 'no repl block');
  }

  // lesson page
  await go('lesson', 'renderLesson', { slug: 'files' }, 'tab=overview');
  await settle();
  check('lesson overview renders', view.querySelectorAll('.lesson-main section').length > 0,
    String(view.querySelectorAll('.lesson-main section').length));
  check('lesson aside exists', !!view.querySelector('.lesson-aside'));

  await go('lesson', 'renderLesson', { slug: 'files' }, 'tab=videos');
  await settle();
  
  check('lesson videos tab has an iframe', !!view.querySelector('.player-shell iframe'),
    view.querySelector('.player-shell iframe')?.getAttribute('src'));
  check('lesson videos tab lists all clips', view.querySelectorAll('.video-card').length === 3,
    String(view.querySelectorAll('.video-card').length));

  await go('lesson', 'renderLesson', { slug: 'files' }, 'tab=slides');
  await settle();
  check('lesson slides tab renders the deck rail', view.querySelectorAll('.deck-rail button').length === 24,
    String(view.querySelectorAll('.deck-rail button').length));

  await go('lesson', 'renderLesson', { slug: 'files' }, 'tab=practice');
  await settle();
  check('lesson practice tab finds exercises', view.querySelectorAll('article.card').length > 0,
    String(view.querySelectorAll('article.card').length));

  // lesson 1 is the setup guides: no empty video/slide/reading tabs
  await go('lesson', 'renderLesson', { slug: 'install' });
  await settle();
  const tabNames = [...view.querySelectorAll('.tabs button')].map((b) => b.textContent);
  check('lesson 1 offers a setup tab', tabNames.some((t) => /Setup/.test(t)), tabNames.join('|'));
  check('lesson 1 hides the empty tabs',
    !tabNames.some((t) => /Videos|Slides|Reading/.test(t)), tabNames.join('|'));
  check('lesson 1 keeps only overview and setup',
    tabNames.map((t) => t.replace(/\d+/g, '')).join(',') === 'Overview,Setup',
    tabNames.join('|'));
  check('lesson 1 overview links to the guides',
    !!view.querySelector('.lesson-main a[href="/lesson/install?tab=setup"]'),
    String(view.querySelectorAll('.lesson-main a').length));

  await go('lesson', 'renderLesson', { slug: 'install' }, 'tab=setup');
  await settle();
  check('lesson 1 setup tab lists the guides',
    view.querySelectorAll('.lesson-main .card-link').length >= 5,
    String(view.querySelectorAll('.lesson-main .card-link').length));
  check('lesson 1 setup tab links to each guide',
    !!view.querySelector('.lesson-main a[href="/setup/mac"]'));

  await go('lesson', 'renderLesson', { slug: 'install' }, 'tab=videos');
  await settle();
  check('lesson 1 falls back to overview for a hidden tab',
    view.querySelectorAll('.tabs button[aria-selected="true"]')[0]?.textContent === 'Overview',
    view.querySelectorAll('.tabs button[aria-selected="true"]')[0]?.textContent);

  // setup guide index + reader
  await go('setup', 'renderSetup', {});
  await settle();
  check('setup index shows 5 guides', view.querySelectorAll('.card-link').length === 5,
    String(view.querySelectorAll('.card-link').length));
  check('setup index links to /setup/mac', !!view.querySelector('a[href="/setup/mac"]'));

  await go('setup', 'renderSetupGuide', { slug: 'mac' });
  await settle();
  check('setup guide renders its body',
    (view.querySelector('.reader-main.book')?.textContent || '').length > 500,
    String(view.querySelector('.reader-main.book')?.textContent?.length));
  check('setup guide has a guide rail',
    view.querySelectorAll('.reader-nav .chapter-list a').length >= 6,
    String(view.querySelectorAll('.reader-nav .chapter-list a').length));
  check('setup guide has on-this-page nav',
    view.querySelectorAll('.reader-onthispage a').length > 2,
    String(view.querySelectorAll('.reader-onthispage a').length));
  check('setup guide upgrades <pre> to codeblocks',
    view.querySelectorAll('.reader-main .codeblock').length > 0,
    String(view.querySelectorAll('.reader-main .codeblock').length));

  await go('setup', 'renderSetupGuide', { slug: 'nope' });
  await settle();
  check('unknown setup guide shows an empty state',
    /No such guide/.test(view.textContent || ''),
    (view.textContent || '').slice(0, 60));

  // reading a guide is progress, and the index reflects it
  await go('setup', 'renderSetupGuide', { slug: 'windows' });
  await settle();
  check('reading a guide records progress', data.isGuideRead('windows'),
    JSON.stringify((data.state.progress.lessons.install || {}).guides));
  check('guide reads count toward lesson 1',
    data.lessonProgress('install').guides >= 1 && data.lessonProgress('install').guidesTotal === 5,
    `${data.lessonProgress('install').guides}/${data.lessonProgress('install').guidesTotal}`);
  await go('setup', 'renderSetup', {});
  await settle();
  check('setup index marks the guide as read',
    view.querySelectorAll('.card-link .badge-ok').length >= 1,
    String(view.querySelectorAll('.card-link .badge-ok').length));
  check('setup index shows the lesson-1 fraction',
    /of 5 guides read/.test(view.textContent || ''),
    (view.textContent || '').match(/\d+ of 5 guides read/)?.[0]);

  // a guide is searchable and links back to /setup
  await go('search', 'renderSearch', {}, 'q=replit');
  await settle();
  const guideHits = [...view.querySelectorAll('.result')]
    .filter((r) => /^\/setup\//.test(r.querySelector('h3 a')?.getAttribute('href') || ''));
  check('search finds the setup guides', guideHits.length > 0,
    String(guideHits.length));
  check('guide hits are labelled as setup',
    guideHits.length > 0 && /Setup ·/.test(guideHits[0].querySelector('.where')?.textContent || ''),
    guideHits[0]?.querySelector('.where')?.textContent);

  // videos index
  await go('videos', 'renderVideos', {});
  await settle();
  check('videos index lists all 87', view.querySelectorAll('.video-card').length === 87,
    String(view.querySelectorAll('.video-card').length));

  // library
  await go('library', 'renderLibrary', {});
  await settle();
  check('library lists files', view.querySelectorAll('.lib-item').length > 100,
    String(view.querySelectorAll('.lib-item').length));
  check('library opened a file', !!view.querySelector('.codeblock code'),
    String(view.querySelector('.codeblock code')?.textContent.length));

  // search
  await go('search', 'renderSearch', {}, 'q=opening%20files');
  await settle();
  check('search returns ranked results', view.querySelectorAll('.result').length > 2,
    String(view.querySelectorAll('.result').length));
  check('search marks matched terms', view.querySelectorAll('.result mark').length > 0,
    String(view.querySelectorAll('.result mark').length));

  // progress
  await go('progress', 'renderProgress', {});
  await settle();
  check('progress dashboard renders metrics', view.querySelectorAll('.metric').length === 6,
    String(view.querySelectorAll('.metric').length));

  /* ---- report ---------------------------------------------------------- */
  console.error = origError;
  let bad = 0;
  console.log('\n=== VIEWS ===');
  for (const r of results) {
    const flag = r.ok ? 'ok  ' : 'FAIL';
    if (!r.ok) bad += 1;
    console.log(`${flag} ${r.url.padEnd(34)} nodes=${String(r.nodes).padStart(5)} text=${String(r.textLen).padStart(6)} h1="${r.h1.slice(0, 46)}"`);
    for (const e of r.errors) console.log('       ! ' + e.split('\n').slice(0, 3).join(' | '));
  }
  console.log('\n=== CHECKS ===');
  for (const c of checks) {
    if (!c.ok) bad += 1;
    console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '  [' + String(c.detail).replace(/\n/g, ' ').slice(0, 90) + ']' : ''}`);
  }
  console.log(bad ? `\n${bad} problem(s)` : '\nall good');
  process.exitCode = bad ? 1 : 0;
}

main().catch((err) => {
  console.error = origError;
  console.error('HARNESS CRASH', err);
  process.exitCode = 2;
});
