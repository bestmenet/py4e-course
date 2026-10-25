/* views/slides.js — the deck index, and one deck paged through in the viewer. */

import { el, icon } from '../core.js';
import { api } from '../api.js';
import { state, lessonProgress } from '../data.js';
import {
  renderFooter, crumbs, metaRow, emptyState, deckViewer,
} from '../components.js';

export function renderSlides(view, params, query) {
  const decks = state.course.decks || [];
  const totalSlides = decks.reduce((sum, deck) => sum + (deck.page_count || 0), 0);

  view.replaceChildren(
    el('div', { class: 'page' },
      el('header', { class: 'page-head' },
        crumbs([{ label: 'Overview', href: '/' }, { label: 'Slides' }]),
        el('h1', {}, 'Lecture slides'),
        el('p', { class: 'lede' }, `${totalSlides} slides from ${decks.length} lecture decks.`)),
      el('div', { class: 'grid grid-3' }, ...decks.map(deckCard))),
    renderFooter());
}

export async function renderDeck(view, params, query) {
  const summary = (state.course.decks || []).find((deck) => deck.slug === params.slug);
  if (!summary) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('No such deck', `There is no lecture deck called “${params.slug}”.`,
          el('a', { class: 'btn btn-primary', href: '/slides' }, 'Back to all decks'))),
      renderFooter());
    return;
  }

  // The deck summary in course.json has no pages; the body has to be fetched.
  const lesson = lessonForDeck(summary);
  const startPage = startPageFrom(query);

  const skeleton = deckSkeleton();
  view.replaceChildren(skeleton, renderFooter());

  let deck;
  try {
    deck = await api.deck(params.slug);
  } catch (err) {
    if (!view.contains(skeleton)) return; // the route moved on while we waited
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('Could not load this deck', err.message || String(err),
          el('a', { class: 'btn btn-outline', href: '/slides' }, 'Back to all decks'))),
      renderFooter());
    return;
  }

  if (!view.contains(skeleton)) return;
  view.replaceChildren(deckPage(deck, lesson, startPage), renderFooter());
}

/* ------------------------------------------------------------ deck index */

/** The lesson a deck belongs to. One deck — the introduction — is also
    attached to the installation lesson, so prefer the one with lectures: that
    is the lesson page whose viewer records "seen" pages for this deck. */
function lessonForDeck(deck) {
  const matches = (state.course.lessons || []).filter((l) => l.deck === deck.slug);
  return matches.find((l) => l.videos.length) || matches[0] || null;
}

function deckCard(deck) {
  const lesson = lessonForDeck(deck);
  const total = deck.page_count || 0;
  const entry = lesson ? state.progress.lessons[lesson.slug] : null;
  const seen = entry && entry.slides ? entry.slides.length : 0;
  const percent = total ? Math.min(100, Math.round((seen / total) * 100)) : 0;

  return el('a', { class: 'card card-link card-pad', href: `/slides/${deck.slug}` },
    el('div', { class: 'thumb', style: { marginBottom: 'var(--s-4)' } },
      el('img', {
        src: `/static/slides/${deck.slug}/slide-01.webp`,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      })),
    el('div', { class: 'row-between' },
      el('span', { class: 'eyebrow' },
        lesson ? `Lesson ${String(lesson.number).padStart(2, '0')}` : 'Deck'),
      el('span', { class: 'num', style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)' } },
        `${total} slides`)),
    el('h3', { style: { fontSize: 'var(--fs-lg)', margin: 'var(--s-2) 0 var(--s-1)' } },
      lesson ? lesson.name : deck.slug),
    lesson
      ? el('div', { style: { marginTop: 'var(--s-3)' } },
        el('div', {
          style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-3)', marginBottom: 'var(--s-2)' },
        }, `Seen ${seen} of ${total}`),
        el('div', { class: 'bar bar-thin' }, el('span', { style: { width: `${percent}%` } })))
      : null);
}

/* ------------------------------------------------------------- deck page */

function deckPage(deck, lesson, startPage) {
  const progress = lesson ? lessonProgress(lesson.slug) : null;
  const title = lesson ? lesson.name : deck.slug;

  return el('div', { class: 'page' },
    el('header', { class: 'page-head' },
      crumbs([
        { label: 'Overview', href: '/' },
        { label: 'Slides', href: '/slides' },
        { label: title },
      ]),
      el('h1', {}, title, ' — Lecture slides'),
      metaRow(
        lesson
          ? el('a', { class: 'row', style: { gap: '0.35em' }, href: `/lesson/${lesson.slug}` },
            icon('bookOpen', 14), `Lesson ${lesson.number} · ${lesson.name}`)
          : null,
        el('span', { class: 'row', style: { gap: '0.35em' } },
          icon('slides', 14), `${deck.page_count} slides`),
        el('a', {
          class: 'row', style: { gap: '0.35em' }, href: `/static/${deck.pdf}`, download: '',
        }, icon('download', 14), 'Download PDF'),
        progress
          ? el('span', { class: 'row', style: { gap: 'var(--s-2)' } },
            el('div', {
              class: 'ring',
              style: { '--pct': progress.percent, width: '34px', height: '34px' },
            }, el('span', { style: { fontSize: 'var(--fs-3xs)' } }, `${progress.percent}%`)),
            el('span', {}, 'Lesson progress'))
          : null)),
    deckViewer(deck, { lessonSlug: lesson ? lesson.slug : null, startPage }));
}

function deckSkeleton() {
  return el('div', { class: 'page' },
    el('div', { class: 'skeleton', style: { height: '0.9rem', width: '20%', marginBottom: 'var(--s-4)' } }),
    el('div', { class: 'skeleton', style: { height: '2.4rem', width: '48%', marginBottom: 'var(--s-4)' } }),
    el('div', { class: 'skeleton', style: { height: '1rem', width: '34%', marginBottom: 'var(--s-6)' } }),
    el('div', { class: 'skeleton', style: { height: '28rem' } }));
}

/** ?p= wins when it names a real page; anything else starts at the first one. */
function startPageFrom(query) {
  const raw = Number(query.get('p'));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}
