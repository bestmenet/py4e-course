/* views/setup.js — the "install Python" guides that lesson 1 is really made of.
   Routes: /setup and /setup/:slug */

import { el, icon, youtubeEmbed, onLeaveView } from '../core.js';
import { api } from '../api.js';
import {
  state, idx, subscribe, GUIDED_LESSON, lessonProgress, isGuideRead, markGuideRead,
} from '../data.js';
import {
  renderFooter, crumbs, emptyState, enhanceChapterCode,
} from '../components.js';

/* ------------------------------------------------------------------ index */

export function renderSetup(view, params, query) {
  const guides = state.course.guides || [];
  if (!guides.length) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('No setup guides', 'This build has no installation pages.')),
      renderFooter());
    return;
  }

  const lesson = idx.lessonBySlug.get(GUIDED_LESSON);
  const statusCard = el('div', { class: 'card card-pad', style: { minWidth: '14rem' } });
  const grid = el('div', { class: 'grid grid-2' });

  const paint = () => {
    const p = lesson ? lessonProgress(GUIDED_LESSON) : null;
    statusCard.replaceChildren(
      el('div', { class: 'row-between', style: { marginBottom: 'var(--s-3)' } },
        el('span', { class: 'eyebrow' }, 'Lesson 1'),
        el('span', { class: `badge ${p && p.done ? 'badge-ok' : 'badge-plain'}` },
          p && p.done ? 'Done' : 'In progress')),
      el('div', { class: 'bar', style: { marginBottom: 'var(--s-3)' } },
        el('span', { style: { width: `${p ? p.percent : 0}%` } })),
      el('div', { class: 'meta-row' },
        el('span', {}, `${p ? p.guides : 0} of ${guides.length} guides read`)),
      el('a', { class: 'btn btn-outline btn-sm', href: `/lesson/${GUIDED_LESSON}`,
        style: { marginTop: 'var(--s-4)' } }, 'Lesson page', icon('arrowRight', 14)));
    grid.replaceChildren(...guides.map((g, i) => guideCard(g, i)));
  };

  view.replaceChildren(
    el('div', { class: 'page' },
      crumbs([{ label: 'Overview', href: '/' }, { label: 'Syllabus', href: '/syllabus' }, { label: 'Setup' }]),
      el('div', { class: 'row-between wrap', style: { marginTop: 'var(--s-3)', marginBottom: 'var(--s-6)', gap: 'var(--s-5)' } },
        el('div', {},
          el('p', { class: 'eyebrow' }, 'Lesson 01'),
          el('h1', { style: { marginTop: 'var(--s-2)' } }, 'Getting Python running'),
          el('p', { class: 'lede', style: { marginTop: 'var(--s-3)' } },
            'You need two things before lesson 2: somewhere to write Python, and a way to run it. '
            + 'Pick whichever of these matches your computer — or skip installation entirely and '
            + 'use the browser.')),
        lesson ? statusCard : null),

      grid,

      el('section', { class: 'section' },
        el('div', { class: 'callout' },
          icon('info', 18),
          el('div', {},
            el('strong', {}, 'Nothing to install to start reading. '),
            'The book, the lecture slides and the sample code all work in this browser right now. '
            + 'Installing Python only matters once you want to write programs of your own — '
            + 'or you can use the ',
            el('a', { href: '/playground' }, 'playground'),
            ', which runs Python in your browser for you.')),
        el('p', { style: { marginTop: 'var(--s-4)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } },
          'The original course also offers a hosted ',
          el('a', {
            href: 'https://shell.py4e.com/', target: '_blank', rel: 'noopener', 'data-external': '1',
          }, 'browser Python shell'),
          ', which needs no installation but does need an internet connection.'))),

    renderFooter());

  paint();
  // keep the "read" badges live if progress changes in another tab of the site
  const unsubscribe = subscribe((_, reason) => {
    if (reason === 'progress' || reason === 'course') paint();
  });
  onLeaveView(unsubscribe);
}

export function guideCard(guide, i) {
  const read = isGuideRead(guide.slug);
  return el('a', { class: 'card card-link card-pad-lg', href: `/setup/${guide.slug}` },
    el('div', { class: 'row-between', style: { marginBottom: 'var(--s-4)' } },
      el('span', {
        class: 'avatar',
        style: { width: '38px', height: '38px', fontSize: 'var(--fs-md)' },
      }, String(i + 1).padStart(2, '0')),
      el('span', { class: `badge ${read ? 'badge-ok' : 'badge-plain'}` },
        read ? 'Read' : `${guide.toc.length} section${guide.toc.length === 1 ? '' : 's'}`)),
    el('h3', { style: { fontSize: 'var(--fs-xl)', marginBottom: 'var(--s-2)' } }, guide.label),
    el('p', { style: { fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } }, guide.blurb),
    el('div', { class: 'meta-row', style: { marginTop: 'var(--s-4)' } },
      el('span', {}, icon('book', 13), `${guide.words} words`),
      el('span', { class: 'sep' }, '·'),
      el('span', {}, icon('clock', 13), `${Math.max(1, Math.round(guide.words / 200))} min`)));
}

/* ------------------------------------------------------------------ reader */

export async function renderSetupGuide(view, params, query) {
  const summary = (state.course.guides || []).find((g) => g.slug === params.slug);
  if (!summary) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('No such guide', `There is no setup guide called “${params.slug}”.`,
          el('a', { class: 'btn btn-primary', href: '/setup' }, 'All setup guides'))),
      renderFooter());
    return;
  }

  view.replaceChildren(el('div', { class: 'reader' },
    el('div', { class: 'reader-nav' }, el('div', { class: 'skeleton', style: { height: '12rem' } })),
    el('div', { class: 'reader-main' }, el('div', { class: 'skeleton', style: { height: '22rem' } })),
    el('div', { class: 'reader-onthispage' })), renderFooter());

  let guide;
  try {
    guide = await api.guide(summary.slug);
  } catch (err) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('Could not load this guide', err.message || String(err))),
      renderFooter());
    return;
  }

  const article = el('article', { class: 'reader-main book', html: guide.html });
  enhanceChapterCode(article, { chapterSlug: `guide-${guide.slug}` });
  markGuideRead(guide.slug);

  const nav = el('nav', { class: 'reader-nav', 'aria-label': 'Setup guides' },
    el('h4', {}, 'Lesson 01 · Setup'),
    el('div', { class: 'chapter-list' },
      ...(state.course.guides || []).map((g, i) => el('a', {
        href: `/setup/${g.slug}`,
        'aria-current': g.slug === guide.slug ? 'true' : null,
      },
      el('span', { class: 'cn' }, String(i + 1)),
      el('span', {}, g.label))),
      el('a', { href: `/lesson/${GUIDED_LESSON}` },
        el('span', { class: 'cn' }, '→'),
        el('span', {}, 'Lesson 1 overview'))));

  const onThisPage = el('nav', { class: 'reader-onthispage', 'aria-label': 'On this page' },
    el('h4', {}, 'On this page'),
    el('div', { class: 'onthispage-list' },
      ...guide.toc.map((t) => el('a', {
        href: `#${t.id}`, dataset: { level: String(t.level) },
      }, t.text))));

  article.append(guideFooter(guide));

  view.replaceChildren(el('div', { class: 'reader' }, nav, article, onThisPage), renderFooter());
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  } else {
    window.scrollTo(0, 0);
  }
}

function guideFooter(guide) {
  const guides = state.course.guides || [];
  const i = guides.findIndex((g) => g.slug === guide.slug);
  const prev = i > 0 ? guides[i - 1] : null;
  const next = i >= 0 && i < guides.length - 1 ? guides[i + 1] : null;

  const videos = (guide.videos || []).filter(Boolean);

  return frag(
    videos.length ? el('section', { style: { marginTop: 'var(--s-7)', fontFamily: 'var(--font-ui)' } },
      el('h4', { class: 'eyebrow', style: { marginBottom: 'var(--s-3)' } },
        videos.length === 1 ? 'Video walkthrough' : 'Video walkthroughs'),
      el('div', { class: 'stack-lg' },
        ...videos.map((id) => el('div', { class: 'player-shell' },
          el('iframe', {
            src: youtubeEmbed(id),
            title: 'Setup walkthrough',
            allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            allowfullscreen: '',
            loading: 'lazy',
          }))))) : null,

    el('div', { class: 'reader-foot' },
      el('div', { class: 'row' },
        prev ? el('a', { class: 'btn btn-outline', href: `/setup/${prev.slug}` },
          icon('arrowLeft', 15), prev.label) : null,
        next ? el('a', { class: 'btn btn-outline', href: `/setup/${next.slug}` },
          next.label, icon('arrowRight', 15)) : null),
      el('div', { class: 'row' },
        el('a', { class: 'btn btn-ghost', href: '/setup' }, 'All setup guides'),
        el('a', { class: 'btn btn-ghost', href: `/lesson/${GUIDED_LESSON}` }, 'Lesson 1'))));
}

/* ------------------------------------------------------------------ helpers */

function frag(...nodes) {
  const out = document.createDocumentFragment();
  for (const n of nodes.flat()) if (n) out.append(n);
  return out;
}
