/* views/videos.js — every lecture video in one filterable index, with an
   inline player that stays open while the filters change. */

import {
  el, icon, fmtTime, debounce, navigate, youtubeEmbed, isOffline,
} from '../core.js';
import { state, markVideoWatched } from '../data.js';
import {
  renderFooter, crumbs, metaRow, emptyState, videoCard, watchToggle,
} from '../components.js';

/* The open video is view state, not URL state: the query carries the filters
   so a filtered list is linkable, while the player follows you across the
   re-renders those filters cause. */
let openVideo = null;
let keepPlayer = false; // set by the filter controls just before they navigate

export function renderVideos(view, params, query) {
  // A filter change keeps the player; arriving from anywhere else starts closed.
  if (!keepPlayer) openVideo = null;
  keepPlayer = false;

  const lessons = state.course.lessons;

  // Flatten the course once; the summary and the grid both read from this list.
  const all = [];
  for (const lesson of lessons) {
    for (const video of lesson.videos) all.push({ lesson, video });
  }
  const totalSeconds = lessons.reduce((sum, lesson) => sum + (lesson.duration_seconds || 0), 0);

  const withVideos = lessons.filter((lesson) => lesson.videos.length);

  // The URL is the source of truth; an unknown lesson slug means “all”.
  const requestedLesson = query.get('lesson') || '';
  const selected = withVideos.some((l) => l.slug === requestedLesson) ? requestedLesson : '';
  const text = (query.get('q') || '').trim().toLowerCase();

  const visible = all.filter(({ lesson, video }) => (
    (!selected || lesson.slug === selected)
    && (!text || video.title.toLowerCase().includes(text))
  ));

  // A filter change re-enters this view through the router, so remember where
  // the caret was and put it back into the rebuilt input.
  const focus = captureFocus(view);

  const results = el('div');

  const paintResults = () => {
    const open = openVideo
      ? all.find(({ lesson, video }) => lesson.slug === openVideo.lessonSlug
        && video.video_id === openVideo.videoId)
      : null;

    const summary = el('div', {
      class: 'meta-row',
      style: { margin: 'var(--s-4) 0 var(--s-3)' },
    }, el('span', {}, `${visible.length} of ${all.length} videos`));

    const body = visible.length
      ? el('div', { class: 'grid grid-2' },
        ...visible.map(({ lesson, video }) => videoTile(lesson, video, open, openInPanel)))
      : emptyState('No videos match those filters',
        'Try a shorter title search, or pick another lesson.',
        el('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => applyFilters('/videos'),
        }, 'Clear filters'));

    results.replaceChildren(...[
      open ? playerPanel(open.lesson, open.video, paintResults) : null,
      summary,
      body,
    ].filter(Boolean));
  };

  const openInPanel = (lesson, video) => {
    openVideo = { lessonSlug: lesson.slug, videoId: video.video_id };
    // Opening counts as watching right away — there is no timer to lose if
    // the visitor pages straight on to another video.
    markVideoWatched(lesson.slug, video.video_id);
    paintResults();
    const panel = results.querySelector('.player-shell');
    if (panel) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const input = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Filter videos by title…',
    'aria-label': 'Filter videos by title',
    value: query.get('q') || '',
  });

  // Every filter change goes through here, so the rebuild it causes knows to
  // leave the player alone.
  const applyFilters = (url) => {
    keepPlayer = true;
    navigate(url, { replace: true });
  };

  // Typing rewrites the URL with replaceState: the list stays linkable, and
  // the back button leaves the page instead of walking through keystrokes.
  const commit = debounce((value) => {
    if (!input.isConnected) return; // a chip click has already rebuilt the bar
    applyFilters(videosUrl(selected, value));
  }, 150);
  input.addEventListener('input', () => commit(input.value));

  const pickLesson = (slug) => applyFilters(videosUrl(slug, input.value));

  const filterbar = el('div', { class: 'filterbar' },
    el('div', { class: 'searchbox', style: { flex: '1 1 15rem', maxWidth: '24rem' } },
      icon('search'), input),
    el('div', { class: 'row wrap', style: { gap: 'var(--s-2)' } },
      lessonChip('All', '', !selected, pickLesson),
      ...withVideos.map((lesson) => lessonChip(
        String(lesson.number).padStart(2, '0'),
        lesson.slug,
        selected === lesson.slug,
        pickLesson,
        lesson))));

  view.replaceChildren(
    el('div', { class: 'page' },
      el('header', { class: 'page-head' },
        crumbs([{ label: 'Overview', href: '/' }, { label: 'Videos' }]),
        el('h1', {}, 'Lecture videos'),
        el('p', { class: 'lede' },
          `${all.length} lecture videos, about ${fmtTime(totalSeconds)} of watch time.`
          + (isOffline() ? ' You are offline, so the videos cannot stream right now.' : ''))),
      filterbar,
      results),
    renderFooter());

  paintResults();
  restoreFocus(input, focus);
}

/* ------------------------------------------------------------- filter bar */

function lessonChip(label, slug, active, onPick, lesson) {
  return el('button', {
    class: active ? 'pill pill-accent' : 'pill',
    type: 'button',
    'aria-pressed': active ? 'true' : 'false',
    title: lesson ? `Lesson ${lesson.number}: ${lesson.name}` : 'Every lesson',
    onclick: () => onPick(slug),
  }, label);
}

/** /videos with only the filters that are actually set. */
function videosUrl(lessonSlug, text) {
  const params = new URLSearchParams();
  if (lessonSlug) params.set('lesson', lessonSlug);
  // Stored verbatim: the box is re-seeded from ?q= after every keystroke, and
  // trimming here would eat the space between two words as you type them.
  if (String(text || '').trim()) params.set('q', text);
  const search = params.toString();
  return search ? `/videos?${search}` : '/videos';
}

function captureFocus(view) {
  const active = document.activeElement;
  if (!active || active.tagName !== 'INPUT' || !view.contains(active)) return null;
  return { value: active.value, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocus(input, focus) {
  if (!focus) return;
  input.value = focus.value; // never lose what the box was still holding
  input.focus({ preventScroll: true });
  try {
    input.setSelectionRange(focus.start, focus.end);
  } catch { /* a search input may refuse a caret range */ }
}

/* ------------------------------------------------------------------ cards */

function videoTile(lesson, video, open, onOpen) {
  return el('div', { class: 'card card-pad' },
    videoCard(video, {
      lesson,
      current: open ? open.video.video_id : null,
      onSelect: () => onOpen(lesson, video),
    }),
    el('div', { style: { marginTop: 'var(--s-2)', paddingLeft: 'var(--s-3)' } },
      el('a', {
        href: `/lesson/${lesson.slug}`,
        style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-3)' },
      }, `Lesson ${lesson.number} · ${lesson.name}`)));
}

function playerPanel(lesson, video, repaint) {
  return el('div', { class: 'player-shell', style: { marginBottom: 'var(--s-5)' } },
    el('div', {
      class: 'row-between wrap',
      style: {
        gap: 'var(--s-3)',
        padding: 'var(--s-3) var(--s-4)',
        background: 'var(--surface-alt)',
        borderBottom: '1px solid var(--line)',
      },
    },
    el('div', { style: { minWidth: 0 } },
      el('div', { class: 'truncate', style: { fontSize: 'var(--fs-sm)', fontWeight: '600' } },
        video.title),
      metaRow(
        el('a', { href: `/lesson/${lesson.slug}` },
          `Lesson ${lesson.number} · ${lesson.name}`),
        video.duration ? el('span', {}, video.duration) : null)),
    el('div', { class: 'row', style: { gap: 'var(--s-2)' } },
      watchToggle(lesson, video),
      el('button', {
        class: 'btn btn-quiet btn-sm',
        type: 'button',
        'aria-label': 'Close player',
        onclick: () => {
          openVideo = null;
          repaint();
        },
      }, icon('x', 14), 'Close'))),
    el('iframe', {
      src: youtubeEmbed(video.video_id, { autoplay: true }),
      title: video.title,
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
      allowfullscreen: '',
    }));
}
