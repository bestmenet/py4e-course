/* components.js — shared renderers used by every view. */

import {
  el, icon, esc, fmtTime, fmtNum, navigate, toast, copyText,
  youtubeThumb, onIdle, isOffline, currentLanguage, setLanguage, t,
} from './core.js';
import { highlight } from './highlight.js';
import { api } from './api.js';
import {
  state, idx, lessonProgress, isVideoWatched, isSlideSeen, markSlideSeen,
  markVideoWatched, subscribe,
} from './data.js';

/* --------------------------------------------------------------- app shell */

let shellEls = null;

export function shell() {
  if (shellEls) return shellEls;
  const topbar = el('header', { class: 'topbar' });
  const view = el('main', { class: 'view', id: 'main-content', tabindex: '-1' });
  const app = el('div', { class: 'app' },
    el('a', { class: 'skip-link', href: '#main-content' }, 'Skip to content'), topbar, view);
  shellEls = { app, topbar, view };
  return shellEls;
}

export function renderTopbar(active) {
  const { topbar } = shell();
  topbar.replaceChildren(
    el('a', { class: 'brand', href: '/', 'aria-label': 'Python for Everybody, home' },
      el('span', { class: 'brand-mark' }, 'py'),
      el('span', { class: 'brand-text' },
        el('b', {}, 'Python for Everybody'),
        el('span', {}, 'Exploring Data Using Python 3'))),
    el('nav', { class: 'topnav', 'aria-label': 'Main' },
      ...[
        ['/', 'Overview'],
        ['/syllabus', 'Syllabus'],
        ['/setup', 'Setup'],
        ['/book', 'Book'],
        ['/videos', 'Videos'],
        ['/slides', 'Slides'],
        ['/library', 'Code'],
        ['/playground', 'Playground'],
      ].map(([href, label]) => el('a', {
        href,
        'aria-current': active === href ? 'page' : null,
      }, label))),
    el('div', { class: 'top-actions' },
      searchBox(),
      languageButton(),
      themeButton(),
      navMenuButton()),
  );
  return topbar;
}

function languageButton() {
  const zh = currentLanguage() === 'zh';
  return el('button', {
    class: 'btn btn-ghost btn-sm language-button',
    'aria-label': zh ? 'Switch language to English' : '切换为简体中文',
    'data-tip': zh ? 'English' : '简体中文',
    onclick: () => setLanguage(zh ? 'en' : 'zh'),
  }, zh ? 'EN' : '中文');
}

function searchBox() {
  const input = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search the book…',
    'aria-label': 'Search',
    onkeydown: (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        navigate(`/search?q=${encodeURIComponent(input.value.trim())}`);
        input.blur();
      }
      if (e.key === 'Escape') input.blur();
    },
  });
  const box = el('div', { class: 'searchbox', style: { width: '15rem' } },
    icon('search'), input, el('kbd', {}, '/'));
  return box;
}

function themeButton() {
  const btn = el('button', {
    class: 'btn btn-ghost btn-icon',
    'aria-label': 'Toggle colour theme',
    'data-tip': 'Theme',
    onclick: () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
        || (!document.documentElement.getAttribute('data-theme')
            && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('py4e:theme', JSON.stringify(next)); } catch { /* ignore */ }
      document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
      paint();
    },
  });
  const paint = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      || (!document.documentElement.getAttribute('data-theme')
          && window.matchMedia('(prefers-color-scheme: dark)').matches);
    btn.replaceChildren(icon(isDark ? 'sun' : 'moon'));
  };
  document.addEventListener('themechange', paint);
  paint();
  return btn;
}

function navMenuButton() {
  const btn = el('button', {
    class: 'btn btn-ghost btn-icon',
    'aria-label': 'More',
    style: { display: 'none' },
  }, icon('menu'));
  // shown by CSS on narrow screens via the topnav breakpoint
  const mq = window.matchMedia('(max-width: 1200px)');
  const sync = () => { btn.style.display = mq.matches ? '' : 'none'; };
  mq.addEventListener('change', sync);
  sync();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = el('div', {
      class: 'menu',
      style: { position: 'fixed', top: '64px', right: '16px', left: 'auto' },
    },
    ...[
      ['/', 'Overview'], ['/syllabus', 'Syllabus'], ['/setup', 'Setup'], ['/book', 'Book'],
      ['/videos', 'Videos'], ['/slides', 'Slides'], ['/library', 'Code'],
      ['/playground', 'Playground'], ['/progress', 'My progress'],
    ].map(([href, label]) => el('a', { href, onclick: () => menu.remove() }, label)));
    document.body.append(menu);
    const dismiss = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', dismiss); }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  });
  return btn;
}

export function renderFooter() {
  return el('footer', { class: 'footer' },
    el('div', { class: 'footer-inner' },
      el('div', {},
        el('div', { class: 'row', style: { marginBottom: 'var(--s-3)' } },
          el('span', { class: 'brand-mark' }, 'py'),
          el('strong', {}, 'Python for Everybody')),
        el('p', { style: { fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', maxWidth: '38ch' } },
          'An independent edition of the PY4E course materials: the full book, every lecture deck, '
          + 'all videos and the complete sample-code library, assembled into one site you can read and run.'),
        el('p', { style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)', marginTop: 'var(--s-3)' } },
          'Course and text © Dr. Charles R. Severance, released under CC BY-NC-SA 4.0.'),
        el('p', { style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)', marginTop: 'var(--s-2)' } },
          'The original book text and lecture videos are in English. This interface and course overview are available in Simplified Chinese.')),
      el('div', {},
        el('h5', {}, 'Course'),
        el('ul', {},
          el('li', {}, el('a', { href: '/syllabus' }, 'Syllabus')),
          el('li', {}, el('a', { href: '/book' }, 'Read the book')),
          el('li', {}, el('a', { href: '/videos' }, 'Lecture videos')),
          el('li', {}, el('a', { href: '/slides' }, 'Lecture slides')))),
      el('div', {},
        el('h5', {}, 'Practise'),
        el('ul', {},
          el('li', {}, el('a', { href: '/library' }, 'Sample code')),
          el('li', {}, el('a', { href: '/playground' }, 'Playground')),
          el('li', {}, el('a', { href: '/progress' }, 'My progress')))),
      el('div', {},
        el('h5', {}, 'Elsewhere'),
        el('ul', {},
          el('li', {}, el('a', { href: 'https://www.py4e.com', target: '_blank', rel: 'noopener' }, 'py4e.com')),
          el('li', {}, el('a', { href: 'https://www.py4e.com/book', target: '_blank', rel: 'noopener' }, 'Get the book')),
          el('li', {}, el('a', { href: 'https://online.dr-chuck.com', target: '_blank', rel: 'noopener' }, 'Online courses'))))),
    el('div', { class: 'footer-bottom' },
      el('span', {}, 'GitHub Pages · progress saved in this browser'),
      el('span', { class: 'num' }, `PY4E · ${t('{count} words', { count: fmtNum(state.course?.stats?.words || 0) })}`)));
}

/* ------------------------------------------------------------ lesson cards */

export function lessonCard(lesson) {
  const p = lessonProgress(lesson.slug);
  const meta = [];
  if (lesson.videos.length) {
    meta.push(el('span', {}, icon('video', 13), t('{count} videos', { count: lesson.videos.length })));
  }
  if (lesson.deck_page_count) {
    meta.push(el('span', {}, icon('slides', 13), t('{count} slides', { count: lesson.deck_page_count })));
  }
  if (lesson.duration_seconds) {
    meta.push(el('span', {}, icon('clock', 13), fmtTime(lesson.duration_seconds)));
  }
  if (lesson.guide_count) {
    meta.push(el('span', {}, icon('download', 13), t('{count} setup guides', { count: lesson.guide_count })));
  }

  return el('a', { class: 'card card-link lesson-card', href: `/lesson/${lesson.slug}` },
    el('div', {},
      el('div', { class: 'row-between' },
        el('span', { class: 'n' }, t('Lesson {number}', { number: String(lesson.number).padStart(2, '0') })),
        p.percent > 0 ? el('span', {
          class: `badge ${p.done ? 'badge-ok' : 'badge-accent'}`,
        }, p.done ? 'Done' : `${p.percent}%`) : null),
      el('h3', {}, lesson.name),
      el('p', { class: 'clamp-3' }, lesson.description)),
    el('div', { class: 'lesson-card-foot' },
      el('div', { class: 'meta' }, meta),
      el('span', { style: { color: 'var(--ink-4)' } }, icon('arrowRight', 15))));
}

export function lessonRow(lesson, index) {
  const p = lessonProgress(lesson.slug);
  return el('a', { class: 'unit', href: `/lesson/${lesson.slug}`, dataset: { done: p.done ? '1' : '0' } },
      el('div', { class: 'unit-num' }, String(lesson.number || index + 1).padStart(2, '0')),
    el('div', {},
      el('div', { class: 'unit-title' }, lesson.name),
      el('div', { class: 'unit-desc' }, lesson.description)),
    el('div', { class: 'unit-side' },
      el('div', { class: 'tag-list' },
        lesson.videos.length ? el('span', { class: 'pill' }, icon('video', 12), `${lesson.videos.length}`) : null,
        lesson.deck_page_count ? el('span', { class: 'pill' }, icon('slides', 12), `${lesson.deck_page_count}`) : null,
        lesson.chapter ? el('span', { class: 'pill' }, icon('book', 12), `Ch ${chapterNumber(lesson.chapter)}`) : null,
        lesson.guide_count ? el('span', { class: 'pill' }, icon('download', 12), `${lesson.guide_count}`) : null),
      p.percent > 0 ? el('div', { class: 'bar bar-warm', style: { width: '86px' } },
        el('span', { style: { width: `${p.percent}%` } })) : null));
}

export function chapterNumber(slug) {
  const c = idx.chapterBySlug.get(slug);
  if (c) return (state.course.chapters.findIndex((x) => x.slug === slug) + 1);
  const m = String(slug || '').match(/^(\d+)/);
  return m ? Number(m[1]) : '·';
}

/* ------------------------------------------------------------- video cards */

export function videoCard(video, { lesson, onSelect, current } = {}) {
  const watched = lesson ? isVideoWatched(lesson.slug, video.video_id) : false;
  // the poster frame comes from YouTube too, so offline it would be a broken box
  const showThumb = video.video_id && !isOffline();
  const card = el('button', {
    class: 'video-card',
    type: 'button',
    'aria-current': current === video.video_id ? 'true' : null,
    onclick: () => onSelect && onSelect(video),
  },
  el('span', { class: 'thumb' },
    showThumb
      ? el('img', { src: youtubeThumb(video.video_id), alt: '', loading: 'lazy', decoding: 'async' })
      : el('span', { class: 'center', style: { height: '100%' } }, icon('video', 22)),
    el('span', { class: 'play' }, icon('play', 30)),
    video.duration ? el('span', { class: 'dur' }, video.duration) : null),
  el('span', { style: { minWidth: 0 } },
    el('span', {
      style: {
        display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical',
        overflow: 'hidden', fontSize: 'var(--fs-sm)', fontWeight: '580', lineHeight: '1.4',
      },
    }, video.title),
    el('span', {
      class: 'meta-row', style: { marginTop: 'var(--s-2)' },
    },
    watched ? el('span', { class: 'badge badge-ok' }, 'watched') : null,
    !watched && video.duration ? el('span', {}, video.duration) : null)));
  return card;
}

/* ---------------------------------------------------------------- code view */

const RUNNABLE_KINDS = new Set(['repl', 'program']);

/**
 * Build the interactive wrapper around a book <pre> element.
 * `pre` is the element pulled out of the chapter HTML.
 */
export function codeBlockFromPre(pre, { chapterSlug } = {}) {
  const raw = pre.textContent.replace(/\s+$/, '');
  const lang = pre.dataset.lang || 'python';
  const kind = pre.dataset.kind || 'output';
  const runnable = RUNNABLE_KINDS.has(kind);
  const codeEl = el('code', { html: highlight(raw, lang) });

  const head = el('div', { class: 'codeblock-head' },
    el('span', { class: 'lang' }, lang),
    kind === 'repl' ? el('span', { class: 'badge badge-plain' }, 'interactive session') : null,
    kind === 'program' ? el('span', { class: 'badge badge-plain' }, 'program') : null,
    el('span', { class: 'grow' }),
    el('button', {
      class: 'btn btn-quiet btn-sm',
      'data-tip': 'Copy',
      'aria-label': 'Copy code',
      onclick: () => copyText(raw).then(() => toast('Copied', 'ok', 1400)),
    }, icon('copy', 14)),
    runnable
      ? el('button', {
          class: 'btn btn-primary btn-sm',
          onclick: () => toggleRun(),
        }, icon('play', 13), 'Run')
      : null);

  const out = el('div', { class: 'runner-out', dataset: { open: '0' } });
  const split = el('div', { class: 'codesplit', dataset: { open: '0' } },
    el('pre', {}, codeEl), out);

  const node = el('div', { class: 'codeblock', dataset: { kind }, id: pre.id || null }, head, split);

  let open = false;
  async function toggleRun() {
    open = !open;
    split.dataset.open = open ? '1' : '0';
    out.dataset.open = open ? '1' : '0';
    if (!open) return;
    out.innerHTML = '<span class="out-label">Running…</span>';
    try {
      const payload = kind === 'repl'
        ? { code: raw, mode: 'repl' }
        : { code: raw, mode: 'script', stdin: '' };
      const result = await api.run(payload);
      renderOutput(out, result);
    } catch (err) {
      out.innerHTML = '';
      out.append(el('span', { class: 'out-label' }, 'Unavailable'));
      out.append(el('span', { class: 'err' }, `Could not run this sample: ${err.message}`));
    }
  }

  return node;
}

export function renderOutput(host, result) {
  host.replaceChildren();
  host.append(el('span', { class: 'out-label' },
    result.ok ? 'Output' : (result.timed_out ? 'Stopped' : 'Output')));
  if (result.stdout) host.append(document.createTextNode(result.stdout));
  if (result.stderr) {
    const errNode = el('span', { class: 'err' }, result.stderr);
    host.append(errNode);
  }
  if (!result.stdout && !result.stderr) {
    host.append(el('span', { class: 'meta' }, '(no output)'));
  }
  host.append(el('span', { class: 'meta' },
    `\n— finished in ${result.duration_ms} ms`));
}

/** Upgrade every runnable <pre> inside a rendered chapter, in place. */
export function enhanceChapterCode(root, { chapterSlug } = {}) {
  const pres = Array.from(root.querySelectorAll('pre'));
  for (const pre of pres) {
    const wrapper = codeBlockFromPre(pre, { chapterSlug });
    pre.replaceWith(wrapper);
  }
  return root;
}

/* --------------------------------------------------------------- slide deck */

export function deckViewer(deck, { lessonSlug, startPage = 1 } = {}) {
  let page = Math.min(Math.max(1, startPage), deck.page_count);
  const stage = el('div', { class: 'stage' });
  const counter = el('div', { class: 'meta-row' },
    el('span', { class: 'num' }, `${page} / ${deck.page_count}`));
  const rail = el('div', { class: 'deck-rail', role: 'tablist', 'aria-label': 'Slides' });
  const notes = el('div', { class: 'slide-notes' });

  const prevBtn = el('button', { class: 'btn btn-outline btn-sm', onclick: () => go(page - 1) },
    icon('chevronLeft', 14), 'Prev');
  const nextBtn = el('button', { class: 'btn btn-outline btn-sm', onclick: () => go(page + 1) },
    'Next', icon('chevronRight', 14));

  const railButtons = deck.pages.map((p) => {
    const btn = el('button', {
      role: 'tab',
      dataset: { seen: isSlideSeen(lessonSlug, p.n) ? '1' : '0' },
      'aria-label': `Slide ${p.n}`,
      onclick: () => go(p.n),
    },
    el('img', { src: `/static/${p.image}`, alt: '', loading: 'lazy', decoding: 'async' }),
      el('span', { class: 'n' }, String(p.n)));
    return btn;
  });
  rail.append(...railButtons);

  function go(n) {
    if (n < 1 || n > deck.page_count) return;
    page = n;
    paint();
    if (lessonSlug) markSlideSeen(lessonSlug, page);
  }

  function paint() {
    const p = deck.pages[page - 1];
    stage.replaceChildren(el('img', {
      src: `/static/${p.image}`,
      alt: p.title ? `Slide ${page}: ${p.title}` : `Slide ${page}`,
      decoding: 'async',
    }));
    counter.replaceChildren(el('span', { class: 'num' }, `${page} / ${deck.page_count}`));
    prevBtn.disabled = page === 1;
    nextBtn.disabled = page === deck.page_count;
    railButtons.forEach((b, i) => {
      b.setAttribute('aria-current', i + 1 === page ? 'true' : 'false');
      if (i + 1 === page && lessonSlug) b.dataset.seen = '1';
    });
    const active = railButtons[page - 1];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    paintNotes(p);
  }

  function paintNotes(p) {
    notes.replaceChildren();
    const bullets = (p.bullets || []).filter(Boolean);
    if (p.title || bullets.length) {
      if (p.title) notes.append(el('h4', {}, p.title));
      if (bullets.length) {
        notes.append(el('ul', {}, ...bullets.map((b) => el('li', {},
          ...b.split('\n').map((line, i) => (i ? el('span', {}, line) : line))))));
      }
    }
    if (!p.title && !bullets.length && p.pdf_text) {
      notes.append(el('h4', {}, 'Slide text'));
      notes.append(el('div', { class: 'slide-transcript' }, p.pdf_text));
    }
    if (p.notes) {
      notes.append(el('h4', { style: { marginTop: 'var(--s-4)' } }, 'Speaker notes'));
      notes.append(el('div', { style: { color: 'var(--ink-2)' } }, p.notes));
    }
    if (!notes.childNodes.length) notes.append(el('span', { class: 'muted' }, 'No text on this slide.'));
  }

  const stageWrap = el('div', { class: 'slide-stage' },
    stage,
    el('div', { class: 'slide-bar' }, prevBtn, counter, nextBtn, el('span', { class: 'grow' }),
      el('a', {
        class: 'btn btn-quiet btn-sm', href: `/static/${deck.pdf}`, download: '',
      }, icon('download', 14), 'PDF'),
      deck.pptx ? el('a', {
        class: 'btn btn-quiet btn-sm', href: `/static/${deck.pptx}`, download: '',
      }, icon('download', 14), 'PPTX') : null),
    notes);

  const root = el('div', { class: 'deck' }, rail, stageWrap);

  // keyboard paging while the viewer is on screen
  const onKey = (e) => {
    if (e.target.matches('input, textarea')) return;
    if (!document.body.contains(root)) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(page + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(page - 1); }
  };
  document.addEventListener('keydown', onKey);

  paint();
  return root;
}

/* ----------------------------------------------------------------- helpers */

export function emptyState(title, body, action) {
  return el('div', { class: 'empty' },
    icon('search', 34),
    el('h3', {}, title),
    el('p', {}, body),
    action ? el('div', { style: { marginTop: 'var(--s-5)' } }, action) : null);
}

export function statTile(value, label, sub) {
  return el('div', { class: 'stat' },
    el('div', { class: 'n' }, value, sub ? el('small', {}, sub) : null),
    el('div', { class: 'l' }, label));
}

export function sectionHead(title, description, actions) {
  return el('div', { class: 'section-head' },
    el('div', {},
      el('h2', {}, title),
      description ? el('p', {}, description) : null),
    actions ? el('div', { class: 'actions' }, actions) : null);
}

export function crumbs(trail) {
  const parts = [];
  trail.forEach((item, i) => {
    if (i) parts.push(el('span', { class: 'sep' }, '/'));
    parts.push(item.href ? el('a', { href: item.href }, item.label) : el('span', {}, item.label));
  });
  return el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, ...parts);
}

export function metaRow(...items) {
  const out = [];
  items.filter(Boolean).forEach((item, i) => {
    if (i) out.push(el('span', { class: 'sep' }, '·'));
    out.push(item);
  });
  return el('div', { class: 'meta-row' }, ...out);
}

/** The small "watched" toggle shown next to a video title. */
export function watchToggle(lesson, video) {
  const watched = isVideoWatched(lesson.slug, video.video_id);
  const btn = el('button', {
    class: `btn btn-sm ${watched ? 'btn-primary' : 'btn-outline'}`,
    onclick: (e) => {
      e.stopPropagation();
      markVideoWatched(lesson.slug, video.video_id).then(() => {
        toast(watched ? 'Marked unwatched' : 'Marked watched', 'ok', 1400);
      });
    },
  }, icon('check', 13), watched ? 'Watched' : 'Mark watched');
  return btn;
}

/** A figure from the book, converted to a lazy <figure>. */
export function bookFigure(src, alt, caption) {
  return el('figure', { class: 'book-figure' },
    el('img', { src, alt: alt || '', loading: 'lazy', decoding: 'async' }),
    caption ? el('figcaption', {}, caption) : null);
}
