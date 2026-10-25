/* views/syllabus.js — the whole course as one ordered list. */

import { el, icon, fmtTime, fmtNum, navigate } from '../core.js';
import { state, courseProgress, lessonProgress } from '../data.js';
import {
  renderFooter, crumbs, lessonRow, sectionHead, emptyState,
} from '../components.js';

export function renderSyllabus(view, params, query) {
  const course = state.course;
  const lessons = course.lessons;
  const progress = courseProgress();

  const filter = query.get('filter') || 'all';
  const shown = filter === 'todo'
    ? lessons.filter((l) => !lessonProgress(l.slug).done)
    : filter === 'done'
      ? lessons.filter((l) => lessonProgress(l.slug).done)
      : lessons;

  const filterBar = el('div', { class: 'segmented' },
    ...[
      ['all', `All ${lessons.length}`],
      ['todo', 'Not finished'],
      ['done', 'Finished'],
    ].map(([key, label]) => el('button', {
      type: 'button',
      'aria-pressed': filter === key ? 'true' : 'false',
      onclick: () => navigate(key === 'all' ? '/syllabus' : `/syllabus?filter=${key}`),
    }, label)));

  const stages = groupIntoStages(lessons);

  view.replaceChildren(
    el('div', { class: 'page' },
      crumbs([{ label: 'Overview', href: '/' }, { label: 'Syllabus' }]),
      el('div', { class: 'row-between wrap', style: { marginTop: 'var(--s-3)', marginBottom: 'var(--s-6)', gap: 'var(--s-5)' } },
        el('div', {},
          el('h1', {}, 'Syllabus'),
          el('p', { class: 'lede', style: { marginTop: 'var(--s-3)' } },
            'Seventeen lessons in four stages. Each one is a lecture to watch, a deck to page through, '
            + 'a chapter to read and a set of exercises to run.')),
        el('div', { class: 'card card-pad', style: { minWidth: '15rem' } },
          el('div', { class: 'row-between', style: { marginBottom: 'var(--s-3)' } },
            el('span', { class: 'eyebrow' }, 'Course progress'),
            el('span', { class: 'num', style: { fontSize: 'var(--fs-lg)', fontWeight: '640' } },
              `${progress.percent}%`)),
          el('div', { class: 'bar bar-thick bar-warm' },
            el('span', { style: { width: `${progress.percent}%` } })),
          el('div', { class: 'meta-row', style: { marginTop: 'var(--s-3)' } },
            el('span', {}, `${progress.done} of ${progress.total} lessons complete`),
            el('span', { class: 'sep' }, '·'),
            el('span', {}, `${progress.videos} of ${progress.videosTotal} videos`)))),

      el('div', { class: 'row-between wrap', style: { marginBottom: 'var(--s-5)' } },
        filterBar,
        el('div', { class: 'meta-row' },
          el('span', {}, icon('book', 14), `${course.stats.chapters} chapters`),
          el('span', { class: 'sep' }, '·'),
          el('span', {}, icon('clock', 14), `${fmtTime(course.stats.seconds)} of video`))),

      shown.length
        ? el('div', {}, ...stages.map((stage) => stageBlock(stage, shown, lessons)))
        : emptyState(
            filter === 'done' ? 'Nothing finished yet' : 'Everything is finished',
            filter === 'done'
              ? 'Work through a lesson and it will show up here.'
              : 'You have completed every lesson in the course. Congratulations.',
            el('a', { class: 'btn btn-outline', href: '/syllabus' }, 'Show all lessons'))),

    renderFooter());
}

function groupIntoStages(lessons) {
  const stages = [
    { name: 'Getting started', note: 'Install Python and write your first program.', range: [1, 2] },
    { name: 'The basics', note: 'Variables, conditionals, functions, loops and strings.', range: [3, 7] },
    { name: 'Working with data', note: 'Files, lists, dictionaries and tuples.', range: [8, 11] },
    { name: 'Talking to the world', note: 'Regular expressions, networks, web services, objects, databases and visualisation.', range: [12, 17] },
  ];
  return stages.map((s) => ({
    ...s,
    lessons: lessons.filter((l) => l.number >= s.range[0] && l.number <= s.range[1]),
  })).filter((s) => s.lessons.length);
}

function stageBlock(stage, shown, all) {
  const visible = stage.lessons.filter((l) => shown.includes(l));
  if (!visible.length) return null;
  return el('section', { style: { marginBottom: 'var(--s-8)' } },
    el('div', { class: 'row', style: { marginBottom: 'var(--s-3)' } },
      el('h2', { style: { fontSize: 'var(--fs-xl)' } }, stage.name),
      el('span', { class: 'badge badge-plain' }, `${visible.length} lesson${visible.length === 1 ? '' : 's'}`)),
    el('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-4)' } }, stage.note),
    el('div', { class: 'syllabus' }, ...visible.map((l) => lessonRow(l, all.indexOf(l)))));
}
