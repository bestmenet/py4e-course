/* views/progress.js — the learner's own dashboard. */

import { el, icon, toast, relTime, onLeaveView } from '../core.js';
import {
  state, courseProgress, lessonProgress, resetProgress, bookmarks, subscribe,
} from '../data.js';
import {
  renderFooter, crumbs, sectionHead, emptyState,
} from '../components.js';

export function renderProgress(view, params, query) {
  const paint = () => {
    const course = state.course;
    const progress = courseProgress();
    const p = state.progress;
    const marks = bookmarks();
    const exercises = Object.entries(p.exercises || {});
    const passed = exercises.filter(([, v]) => v.passed).length;
    const streaks = (p.streak && p.streak.days) || [];

    const inProgress = course.lessons
      .map((l) => ({ lesson: l, p: lessonProgress(l.slug) }))
      .filter((x) => x.p.percent > 0 && !x.p.done)
      .sort((a, b) => b.p.percent - a.p.percent);

    const notStarted = course.lessons.filter((l) => lessonProgress(l.slug).percent === 0);

    view.replaceChildren(
      el('div', { class: 'page' },
        crumbs([{ label: 'Overview', href: '/' }, { label: 'My progress' }]),
        el('div', { class: 'row-between wrap', style: { marginTop: 'var(--s-3)', marginBottom: 'var(--s-6)', gap: 'var(--s-5)' } },
          el('div', {},
            el('h1', {}, 'My progress'),
            el('p', { class: 'lede', style: { marginTop: 'var(--s-3)' } },
              'Your learning progress, notes and bookmarks are saved in this browser. '
              + 'Use the same browser to continue; progress does not sync between devices.')),
          el('div', { class: 'row' },
            el('button', {
              class: 'btn btn-danger',
              onclick: () => confirmReset(),
            }, icon('reset', 15), 'Reset progress'))),

        el('div', { class: 'dash-grid' },
          metric(`${progress.percent}%`, 'Course complete'),
          metric(`${progress.done}`, 'Lessons finished', `of ${progress.total}`),
          metric(`${progress.videos}`, 'Videos watched', `of ${progress.videosTotal}`),
          metric(`${passed}`, 'Exercises solved', exercises.length ? `of ${exercises.length} tried` : 'none yet'),
          metric(`${marks.length}`, 'Bookmarks'),
          metric(`${streaks.length}`, 'Active days')),

        el('section', { class: 'section' },
          el('div', { class: 'card card-pad-lg' },
            el('div', { class: 'row-between', style: { marginBottom: 'var(--s-4)' } },
              el('h2', { style: { fontSize: 'var(--fs-xl)' } }, 'Overall'),
              el('span', { class: 'num', style: { fontSize: 'var(--fs-2xl)', fontWeight: '640' } },
                `${progress.percent}%`)),
            el('div', { class: 'bar bar-thick bar-warm' }, el('span', { style: { width: `${progress.percent}%` } })),
            el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 'var(--s-5)' } },
              ...course.lessons.map((l) => {
                const lp = lessonProgress(l.slug);
                return el('a', {
                  href: `/lesson/${l.slug}`,
                  class: 'row',
                  style: { gap: 'var(--s-3)', textDecoration: 'none', color: 'inherit', padding: 'var(--s-2) 0' },
                },
                el('span', {
                  class: 'check', dataset: { done: lp.done ? '1' : '0' },
                }, icon('check', 11)),
                el('span', { class: 'grow truncate', style: { fontSize: 'var(--fs-xs)' } },
                  `${l.number}. ${l.name}`),
                el('span', { class: 'num', style: { fontSize: 'var(--fs-3xs)', color: 'var(--ink-4)' } },
                  `${lp.percent}%`));
              })))),

        inProgress.length
          ? el('section', { class: 'section' },
              sectionHead('Pick up where you left off', 'Lessons you have started but not finished.'),
              el('div', { class: 'grid grid-3' },
                ...inProgress.slice(0, 6).map(({ lesson, p: lp }) => el('a', {
                  class: 'card card-link card-pad', href: `/lesson/${lesson.slug}`,
                },
                el('div', { class: 'row-between', style: { marginBottom: 'var(--s-3)' } },
                  el('div', { class: 'ring', style: { '--pct': lp.percent } }, el('span', {}, `${lp.percent}%`)),
                  el('span', { class: 'badge badge-warm' }, `${lp.videos}/${lp.videosTotal} videos`)),
                el('h3', { style: { fontSize: 'var(--fs-base)' } }, lesson.name),
                el('p', { class: 'muted', style: { fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' } },
                  `${lp.slides} of ${lp.slidesTotal} slides · ${lp.read ? 'chapter read' : 'chapter unread'}`)))))
          : null,

        marks.length
          ? el('section', { class: 'section' },
              sectionHead('Bookmarks', 'Sections you marked while reading.'),
              el('div', { class: 'grid grid-3' },
                ...marks.map((b) => el('a', {
                  class: 'card card-link card-pad',
                  href: `/read/${b.chapter}${b.anchor ? `#${b.anchor}` : ''}`,
                },
                el('div', { class: 'row', style: { marginBottom: 'var(--s-2)' } },
                  icon('bookmark', 13),
                  el('span', { style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)' } },
                    b.chapter.replace(/^\d+-/, '').replace(/-/g, ' '))),
                el('div', { style: { fontSize: 'var(--fs-sm)', fontWeight: '580' } }, b.title || b.anchor),
                el('div', { class: 'muted', style: { fontSize: 'var(--fs-3xs)', marginTop: 'var(--s-2)' } },
                  relTime(b.at))))))
          : null,

        exercises.length
          ? el('section', { class: 'section' },
              sectionHead('Exercises', 'Problems you have touched.'),
              el('div', { class: 'panel' },
                el('div', { class: 'panel-head' },
                  el('h4', {}, `${exercises.length} attempted`),
                  el('span', { class: 'badge badge-ok' }, `${passed} solved`)),
                ...exercises.map(([id, value]) => el('div', {
                  class: 'row-between',
                  style: { padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--line-soft)' },
                },
                el('div', { class: 'row' },
                  el('span', { class: `check`, dataset: { done: value.passed ? '1' : '0' } }, icon('check', 11)),
                  el('span', { class: 'mono', style: { fontSize: 'var(--fs-xs)' } }, id)),
                el('div', { class: 'row' },
                  value.code ? el('span', { class: 'muted', style: { fontSize: 'var(--fs-3xs)' } },
                    `${value.code.split('\n').length} lines`) : null,
                  el('span', { class: 'muted', style: { fontSize: 'var(--fs-3xs)' } }, relTime(value.updated)))))))
          : null,

        notStarted.length === course.lessons.length
          ? el('section', { class: 'section' },
              emptyState('Nothing started yet',
                'Watch a lecture or read a chapter and this page fills in as you go.',
                el('a', { class: 'btn btn-primary', href: '/lesson/install' }, 'Start lesson 1')))
          : null),

      renderFooter());
  };

  paint();
  const unsubscribe = subscribe((_, reason) => {
    if (reason === 'progress') paint();
  });
  onLeaveView(unsubscribe);
}

function metric(value, label, sub) {
  return el('div', { class: 'metric' },
    el('div', { class: 'v' }, value, sub ? el('small', {}, ` ${sub}`) : null),
    el('div', { class: 'k' }, label));
}

function confirmReset() {
  const overlay = el('div', { class: 'modal-backdrop' },
    el('div', { class: 'modal' },
      el('div', { class: 'modal-head' }, el('h2', { style: { fontSize: 'var(--fs-lg)' } }, 'Reset all progress?')),
      el('div', { class: 'modal-body' },
        el('p', {},
          'This clears every watched video, read chapter, bookmark, exercise and note stored for '
          + 'this course in this browser. It cannot be undone.')),
      el('div', { class: 'modal-foot' },
        el('button', {
          class: 'btn btn-outline',
          onclick: () => overlay.remove(),
        }, 'Cancel'),
        el('button', {
          class: 'btn btn-danger',
          onclick: () => {
            resetProgress().then(() => {
              overlay.remove();
              toast('Progress cleared', '', 2000);
            });
          },
        }, 'Reset everything'))));
  document.body.append(overlay);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  });
}
