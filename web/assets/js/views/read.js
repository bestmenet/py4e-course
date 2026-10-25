/* views/read.js — the chapter reader: full book text, live table of contents,
   runnable code samples, per-chapter notes and bookmarks. */

import {
  el, icon, fmtNum, navigate, toast, throttle, store, onLeaveView, t,
} from '../core.js';
import { api } from '../api.js';
import {
  state, idx, toggleBookmark, saveNote, noteFor, bookmarks, setLessonRead, subscribe,
} from '../data.js';
import {
  renderFooter, crumbs, emptyState, enhanceChapterCode,
} from '../components.js';

export async function renderRead(view, params, query) {
  const summary = idx.chapterBySlug.get(params.slug);
  if (!summary) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('No such chapter', `There is no chapter called “${params.slug}”.`,
          el('a', { class: 'btn btn-primary', href: '/book' }, 'Back to the book'))),
      renderFooter());
    return;
  }

  view.replaceChildren(readerSkeleton(summary), renderFooter());

  let chapter;
  try {
    chapter = await api.chapter(summary.slug);
  } catch (err) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('Could not load this chapter', err.message || String(err),
          el('a', { class: 'btn btn-outline', href: '/' }, 'Back to overview'))),
      renderFooter());
    return;
  }

  const article = el('article', { class: 'reader-main book', lang: 'en', html: chapter.html });
  await settleFigures(article);
  enhanceChapterCode(article, { chapterSlug: chapter.slug });
  decorateHeadings(article, chapter);

  const nav = chapterNav(chapter);
  const onThisPage = onThisPageNav(chapter);
  const shell = el('div', { class: 'reader' }, nav, article, onThisPage);

  const pager = chapterPager(chapter);
  article.append(pager);

  view.replaceChildren(shell, renderFooter());

  // deep link support: /read/07-files#opening-files
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  } else {
    window.scrollTo(0, 0);
  }

  trackReading(article, chapter);
  wireOnThisPage(onThisPage);
  wireNotes(article, chapter);
  return shell;
}

/* ---------------------------------------------------------------- skeleton */

function readerSkeleton(summary) {
  return el('div', { class: 'reader' },
    el('div', { class: 'reader-nav' },
      el('div', { class: 'skeleton', style: { height: '11rem' } })),
    el('div', { class: 'reader-main' },
      el('div', { class: 'skeleton', style: { height: '1rem', width: '30%', marginBottom: '1.5rem' } }),
      el('div', { class: 'skeleton', style: { height: '2.6rem', width: '80%', marginBottom: '1rem' } }),
      ...Array.from({ length: 8 }, () => el('div', {
        class: 'skeleton',
        style: { height: '1rem', marginBottom: '0.6rem', width: `${72 + Math.random() * 26}%` },
      }))),
    el('div', { class: 'reader-onthispage' }));
}

/* --------------------------------------------------------------------- nav */

function chapterNav(current) {
  const chapters = state.course.chapters;
  const marks = bookmarks().filter((b) => b.chapter === current.slug);
  return el('nav', { class: 'reader-nav', 'aria-label': 'Chapters' },
    el('h4', {}, 'The book'),
    el('div', { class: 'chapter-list' },
      ...chapters.map((c, i) => el('a', {
        href: `/read/${c.slug}`,
        'aria-current': c.slug === current.slug ? 'true' : null,
      },
      el('span', { class: 'cn' }, String(i + 1)),
      el('span', {}, c.title)))),
    marks.length
      ? el('div', { style: { marginTop: 'var(--s-5)' } },
          el('h4', { style: { marginBottom: 'var(--s-2)' } }, 'Your bookmarks'),
          el('div', { class: 'aside-list' },
            ...marks.map((b) => el('a', { href: `#${b.anchor}` },
              icon('bookmark', 13),
              el('span', { class: 'truncate' }, b.title || b.anchor)))))
      : null,
    el('div', { style: { marginTop: 'var(--s-5)', paddingLeft: 'var(--s-3)' } },
      el('a', { class: 'btn btn-ghost btn-sm', href: '/book' },
        icon('bookOpen', 14), 'Reading modes')));
}

function onThisPageNav(chapter) {
  const items = chapter.toc.filter((t) => t.level === 1 || t.level === 2);
  return el('nav', { class: 'reader-onthispage', 'aria-label': 'On this page' },
    el('h4', {}, 'On this page'),
    el('div', { class: 'onthispage-list' },
      ...items.map((t) => el('a', {
        href: `#${t.id}`,
        dataset: { level: String(t.level), target: t.id },
      }, t.text))));
}

function wireOnThisPage(nav) {
  const links = Array.from(nav.querySelectorAll('a[data-target]'));
  if (!links.length) return;
  const targets = links
    .map((a) => ({ link: a, node: document.getElementById(a.dataset.target) }))
    .filter((t) => t.node);

  const update = throttle(() => {
    const top = window.scrollY + 120;
    let activeIndex = 0;
    targets.forEach((t, i) => { if (t.node.offsetTop <= top) activeIndex = i; });
    links.forEach((a) => a.removeAttribute('data-active'));
    targets[activeIndex].link.dataset.active = '1';
  }, 120);

  window.addEventListener('scroll', update, { passive: true });
  onLeaveView(() => window.removeEventListener('scroll', update));
  update();
}

/* -------------------------------------------------------------- decoration */

function decorateHeadings(article, chapter) {
  // anchor links on every section heading, plus a bookmark control
  for (const heading of article.querySelectorAll('h2[id], h3[id]')) {
    if (heading.querySelector('.bookmark-btn')) continue;
    const id = heading.id;
    heading.style.display = 'flex';
    heading.style.alignItems = 'baseline';
    heading.style.gap = 'var(--s-3)';
    heading.append(el('span', { class: 'grow', style: { flex: '1 1 auto' } }));
    heading.append(el('a', {
      href: `#${id}`,
      class: 'btn btn-quiet btn-sm',
      'data-tip': 'Link to this section',
      'aria-label': `Permalink to ${heading.textContent.trim()}`,
      style: { opacity: '0.55' },
      onclick: (e) => {
        e.preventDefault();
        history.replaceState({}, '', `#${id}`);
        try { navigator.clipboard.writeText(location.href); } catch { /* ignore */ }
        toast('Link copied', 'ok', 1300);
      },
    }, '#'));
    const marked = bookmarks().some((b) => b.chapter === chapter.slug && b.anchor === id);
    heading.append(el('button', {
      class: 'bookmark-btn btn btn-quiet btn-sm',
      'data-tip': marked ? 'Remove bookmark' : 'Bookmark this section',
      'aria-label': marked ? 'Remove bookmark' : 'Bookmark this section',
      style: { opacity: marked ? '1' : '0.55', color: marked ? 'var(--gold)' : '' },
      onclick: (e) => {
        const btn = e.currentTarget;
        const isMarked = bookmarks().some((b) => b.chapter === chapter.slug && b.anchor === id);
        toggleBookmark(chapter.slug, id, heading.textContent.trim().replace(/#$/, ''));
        btn.style.color = isMarked ? '' : 'var(--gold)';
        btn.style.opacity = isMarked ? '0.55' : '1';
        btn.setAttribute('data-tip', isMarked ? 'Bookmark this section' : 'Remove bookmark');
        toast(isMarked ? 'Bookmark removed' : 'Bookmarked', isMarked ? '' : 'ok', 1400);
      },
    }, icon('bookmark', 14)));
  }

  // highlight external links so they are obviously leaving the site
  for (const a of article.querySelectorAll('a[href^="http"]')) {
    if (!a.dataset.external) {
      a.dataset.external = '1';
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  }
}

/** Swap any broken figure for an inline notice rather than a broken box.
 *
 * Each image is raced against a short timeout: a figure that never finishes
 * loading must not hold up the chapter, and `load`/`error` are not guaranteed
 * to fire for every element in every engine. */
function settleFigures(root) {
  const images = Array.from(root.querySelectorAll('img'));
  return Promise.all(images.map((img) => new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2500);
    img.addEventListener('error', () => {
      const host = img.closest('figure') || img;
      host.replaceWith(el('div', { class: 'callout callout-warm', style: { margin: '1.6em 0' } },
        icon('warn', 18),
        el('div', {}, 'This figure is missing from the local copy: ',
          el('code', {}, img.getAttribute('src') || 'unknown'))));
      done();
    }, { once: true });
    img.addEventListener('load', done, { once: true });
    if (img.complete) done();
  })));
}

/* ------------------------------------------------------------------ footer */

function chapterPager(chapter) {
  const chapters = state.course.chapters;
  const i = chapters.findIndex((c) => c.slug === chapter.slug);
  const prev = i > 0 ? chapters[i - 1] : null;
  const next = i >= 0 && i < chapters.length - 1 ? chapters[i + 1] : null;
  const lesson = state.course.lessons.find((l) => l.chapter === chapter.slug);

  const readBtn = lesson ? el('button', {
    class: 'btn btn-outline',
    onclick: (e) => {
      const entry = state.progress.lessons[lesson.slug] || {};
      const nextState = !entry.read;
      setLessonRead(lesson.slug, nextState);
      e.currentTarget.textContent = t(nextState ? 'Chapter read' : 'Mark chapter as read');
      toast(t(nextState ? 'Marked as read' : 'Marked unread'), nextState ? 'ok' : '', 1500);
    },
  }, icon('check', 15), (state.progress.lessons[lesson.slug] || {}).read ? 'Chapter read' : 'Mark chapter as read') : null;

  return el('div', { class: 'reader-foot', lang: document.documentElement.lang },
    el('div', { class: 'row' },
      prev ? el('a', { class: 'btn btn-outline', href: `/read/${prev.slug}` },
        icon('arrowLeft', 15), prev.title) : null,
      next ? el('a', { class: 'btn btn-outline', href: `/read/${next.slug}` },
        next.title, icon('arrowRight', 15)) : null),
    el('div', { class: 'row' },
      readBtn,
      lesson ? el('a', { class: 'btn btn-ghost', href: `/lesson/${lesson.slug}` },
        'Lesson page', icon('arrowUpRight', 14)) : null));
}

/* -------------------------------------------------------------- reading log */

/** Remember the furthest section a reader reached, per chapter. */
function trackReading(article, chapter) {
  const headings = Array.from(article.querySelectorAll('h2[id]'));
  if (!headings.length) return;
  const update = throttle(() => {
    if (!article.isConnected) return;
    const top = window.scrollY + 140;
    let last = null;
    for (const h of headings) { if (h.offsetTop <= top) last = h; }
    if (last) {
      const key = `reach:${chapter.slug}`;
      const previous = store.get(key);
      if (previous !== last.id) {
        store.set(key, last.id);
        store.set(`reachTitle:${chapter.slug}`, last.textContent.trim());
      }
    }
  }, 400);
  window.addEventListener('scroll', update, { passive: true });
  onLeaveView(() => window.removeEventListener('scroll', update));
  update();
}

/* --------------------------------------------------------------- notes pane */

function wireNotes(article, chapter) {
  const existing = noteFor(chapter.slug);
  const pad = el('textarea', {
    class: 'note-pad',
    placeholder: 'Notes on this chapter — saved in this browser as you type.',
    spellcheck: 'false',
  });
  pad.value = existing;

  const status = el('span', { class: 'muted', style: { fontSize: 'var(--fs-2xs)' } },
    existing ? 'Saved' : '');

  const persist = (text) => {
    saveNote(chapter.slug, text).then(() => {
      status.textContent = t('Saved {time}', { time: new Date().toLocaleTimeString() });
    });
  };

  pad.addEventListener('input', () => {
    status.textContent = t('Saving…');
    persist(pad.value);
  });

  const panel = el('section', {
    class: 'card card-pad-lg',
    lang: document.documentElement.lang,
    style: { marginTop: 'var(--s-8)', fontFamily: 'var(--font-ui)' },
  },
  el('div', { class: 'row-between', style: { marginBottom: 'var(--s-3)' } },
    el('h3', { style: { fontSize: 'var(--fs-lg)' } }, 'Your notes'),
    status),
  pad,
  bookmarks().filter((b) => b.chapter === chapter.slug).length
    ? el('div', { style: { marginTop: 'var(--s-5)' } },
        el('h4', { class: 'eyebrow', style: { marginBottom: 'var(--s-3)' } }, 'Bookmarked sections'),
        el('div', { class: 'aside-list' },
          ...bookmarks().filter((b) => b.chapter === chapter.slug).map((b) => el('a', {
            href: `#${b.anchor}`,
          }, icon('bookmark', 13), el('span', {}, b.title || b.anchor)))))
    : null);

  article.append(panel);
}
