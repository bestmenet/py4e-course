import { routePath } from '../runtime.js';
/* views/book.js — the book's front matter: cover, contents, reading modes. */

import { el, icon, fmtNum, fmtTime, navigate, toast, copyText, t } from '../core.js';
import { state, idx, bookmarks, lessonProgress } from '../data.js';
import {
  renderFooter, crumbs, sectionHead, lessonRow, emptyState,
} from '../components.js';

export function renderBook(view, params, query) {
  const course = state.course;
  const chapters = course.chapters;

  if (chapters.length && (routePath() === '/read' || routePath() === '/read/')) {
    // /read is a convenience alias for the first chapter
    navigate(`/read/${chapters[0].slug}`, { replace: true });
    return;
  }

  const marks = bookmarks();
  const words = course.stats.words;

  view.replaceChildren(
    el('div', { class: 'page' },
      crumbs([{ label: 'Overview', href: '/' }, { label: 'Book' }]),

      el('div', { class: 'grid-split', style: { marginTop: 'var(--s-4)' } },
        el('div', {},
          el('h1', {}, 'Python for Everybody'),
          el('p', { class: 'lede', style: { marginTop: 'var(--s-3)' } },
            t('Exploring Data Using Python 3 — the complete text, sixteen chapters, available right here. Every figure, table and code sample is here, and the code samples run in place.')),
          el('div', { class: 'meta-row', style: { marginTop: 'var(--s-5)' } },
            el('span', {}, icon('bookOpen', 14), t('{count} chapters', { count: chapters.length })),
            el('span', { class: 'sep' }, '·'),
            el('span', {}, icon('note', 14), t('{count} words', { count: fmtNum(words) })),
            el('span', { class: 'sep' }, '·'),
            el('span', {}, icon('clock', 14), t('~{hours} hours to read', { hours: Math.round(words / 220 / 60 * 10) / 10 }))),
          el('div', { class: 'row', style: { marginTop: 'var(--s-6)' } },
            el('a', { class: 'btn btn-primary btn-lg', href: `/read/${chapters[0].slug}` },
              icon('book', 16), 'Start reading'),
            el('a', { class: 'btn btn-outline btn-lg', href: '/search' },
              icon('search', 16), 'Search the text'))),

        el('div', { class: 'card card-pad-lg' },
          el('p', {
            class: 'read',
            style: { fontSize: 'var(--fs-lg)', lineHeight: '1.65', color: 'var(--ink-2)' },
          }, t('“Writing programs is a very creative and rewarding activity. You can write programs for many reasons, ranging from making your living to solving a difficult data analysis problem to having fun to helping someone else solve a problem.”')),
          el('div', { class: 'meta-row', style: { marginTop: 'var(--s-4)' } },
            el('span', {}, 'Dr. Charles R. Severance'),
            el('span', { class: 'sep' }, '·'),
            el('span', {}, 'CC BY-NC-SA 4.0')),
          el('div', { class: 'row', style: { marginTop: 'var(--s-5)' } },
            el('a', {
              class: 'btn btn-outline btn-sm',
              href: 'https://www.py4e.com/book',
              target: '_blank', rel: 'noopener', 'data-external': '1',
            }, icon('external', 14), 'Get the print / ebook edition')))),

      marks.length
        ? el('section', { class: 'section' },
            sectionHead('Your bookmarks',
              t(marks.length === 1 ? '{count} section you marked while reading.' : '{count} sections you marked while reading.', { count: marks.length })),
            el('div', { class: 'grid grid-3' },
              ...marks.slice(0, 12).map((b) => {
                const chapter = idx.chapterBySlug.get(b.chapter);
                return el('a', {
                  class: 'card card-link card-pad',
                  href: `/read/${b.chapter}${b.anchor ? `#${b.anchor}` : ''}`,
                },
                el('div', { class: 'row', style: { marginBottom: 'var(--s-2)' } },
                  icon('bookmark', 14),
                  el('span', { style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)' } },
                    chapter ? chapter.title : b.chapter)),
                el('div', { style: { fontSize: 'var(--fs-sm)', fontWeight: '580' } },
                  b.title || b.anchor));
              })))
        : null,

      el('section', { class: 'section' },
        sectionHead('Contents',
            t('Sixteen chapters, in order. Each links to the matching lesson.'), [
            el('a', { class: 'btn btn-outline btn-sm', href: '/syllabus' }, 'Lessons view', icon('arrowRight', 14)),
          ]),
        el('div', { class: 'syllabus' },
          ...chapters.map((chapter, i) => chapterRow(chapter, i)))),

      el('section', { class: 'section' },
        el('div', { class: 'callout' },
          icon('info', 18),
          el('div', {},
            t('About the text. The book was written by Dr. Charles R. Severance and is released under CC BY-NC-SA 4.0. This offline edition reproduces it unmodified apart from rewriting asset links to point at local copies.'))))),

    renderFooter());
}

function chapterRow(chapter, index) {
  const lesson = state.course.lessons.find((l) => l.chapter === chapter.slug);
  const p = lesson ? lessonProgress(lesson.slug) : null;
  const sections = (chapter.toc || []).filter((t) => t.level === 2);
  const reach = readReach(chapter.slug, sections);

  return el('a', { class: 'unit', href: `/read/${chapter.slug}`, dataset: { done: p && p.read ? '1' : '0' } },
    el('div', { class: 'unit-num' }, String(index + 1).padStart(2, '0')),
    el('div', {},
      el('div', { class: 'unit-title' }, chapter.title),
      el('div', { class: 'unit-desc' },
        sections.slice(0, 4).map((s) => s.text).join(' · ')
        + (sections.length > 4 ? ` · +${sections.length - 4} more` : '')),
      reach
        ? el('div', { class: 'meta-row', style: { marginTop: 'var(--s-2)' } },
            el('span', {}, icon('bookmark', 12), t('Reached: {section}', { section: reach })))
        : null),
    el('div', { class: 'unit-side' },
      el('div', { class: 'tag-list' },
        el('span', { class: 'pill' }, t('{count} sections', { count: sections.length })),
        el('span', { class: 'pill' }, t('{count} words', { count: fmtNum(chapter.words) })),
        p && p.read ? el('span', { class: 'pill pill-accent' }, icon('check', 11), 'read') : null)));
}

/** The furthest section this reader reached in a chapter, if any. */
function readReach(slug, sections) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(`py4e:reachTitle:${slug}`) || 'null'); } catch { /* ignore */ }
  return stored;
}
