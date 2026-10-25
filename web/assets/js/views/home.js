/* views/home.js — the course landing page. */

import { el, icon, fmtTime, fmtNum, navigate } from '../core.js';
import { state, courseProgress, lessonProgress } from '../data.js';
import { lessonCard, videoCard, sectionHead, statTile } from '../components.js';

export function renderHome(view) {
  const course = state.course;
  const stats = course.stats || {};
  const progress = courseProgress();
  const lessons = course.lessons;

  view.replaceChildren(
    hero(course, progress),
    statStrip(stats),
    el('div', { class: 'page' },
      progress.percent > 0 ? continueCard(progress) : null,
      el('section', { class: 'section', style: { marginTop: 'var(--s-8)' } },
        sectionHead('The seventeen lessons',
          'Two to three hours each. Watch the lecture, page through the slides, read the matching '
          + 'chapter, then run the examples yourself.',
          [el('a', { class: 'btn btn-outline btn-sm', href: '/syllabus' }, 'Full syllabus', icon('arrowRight', 14))]),
        el('div', { class: 'grid grid-3' }, ...lessons.map(lessonCard))),

      el('section', { class: 'section' },
        sectionHead('Start with the first lecture',
          'The whole course is 87 short videos — about ' + fmtTime(stats.seconds) + ' of watch time.',
          [el('a', { class: 'btn btn-outline btn-sm', href: '/videos' }, 'All videos', icon('arrowRight', 14))]),
        videoStrip(course)),

      el('section', { class: 'section' },
        sectionHead('Read the book online',
          'All sixteen chapters are here, with the figures, tables and every code sample — '
          + 'and you can run the samples without leaving the page.'),
        chapterGrid(course)),

      el('section', { class: 'section' },
        sectionHead('Or write your own',
          'A scratchpad that runs real Python in your browser, with all the course data files '
          + 'already in place.',
          [el('a', { class: 'btn btn-primary btn-sm', href: '/playground' }, icon('terminal', 14), 'Open playground')]),
        el('div', { class: 'grid grid-2' },
          practiceCard('python', 'Code playground',
            'Write and run Python in the browser. mbox.txt, romeo.txt, words.txt and 130 other sample '
            + 'files are one directory away.', '/playground'),
          practiceCard('layers', 'Sample library',
            'Every program and data file the book references, browsable and runnable.',
            '/library'),
          practiceCard('slides', 'Lecture slides',
            '629 slides across sixteen decks, rendered as images so they page instantly.',
            '/slides'),
          practiceCard('target', 'Your progress',
            'Which lessons you have finished, which videos you have watched, and what you bookmarked.',
            '/progress')))),
    footerCopy());
}

/* --------------------------------------------------------------- sections */

function hero(course, progress) {
  return el('section', { class: 'hero' },
    el('div', { class: 'hero-inner' },
      el('div', {},
        el('p', { class: 'eyebrow', style: { marginBottom: 'var(--s-4)' } },
          'Dr. Chuck · University of Michigan · CC BY-NC-SA'),
        el('h1', {}, 'Learn to program by ', el('em', {}, 'solving problems'), ' that matter.'),
        el('p', { class: 'hero-lede' },
          'Python for Everybody is the course that has introduced millions of people to programming. '
          + 'This is the whole thing — the book, every lecture, all the slides and the complete '
          + 'sample-code library — assembled into one site that runs in your browser, '
          + 'with no separate course downloads.'),
        el('div', { class: 'hero-actions' },
          el('a', { class: 'btn btn-primary btn-lg', href: '/lesson/install' },
            icon('play', 16), 'Start lesson 1'),
          el('a', { class: 'btn btn-outline btn-lg', href: '/book' },
            icon('book', 16), 'Read the book'),
          progress.percent > 0
            ? el('a', { class: 'btn btn-ghost', href: '/progress' }, `Resume · ${progress.percent}% done`)
            : null)),
      el('div', { class: 'hero-card' },
        el('p', { class: 'card-quote' },
          '“Programming is a very creative and rewarding activity. Once you know how to program '
          + 'you will figure out what you want to do with your newfound skills.”'),
        el('div', { class: 'hero-code' },
          el('div', {}, el('span', { class: 'c' }, '# the very first program'), ),
          el('div', {},
            el('span', { class: 'k' }, 'print'), '(', el('span', { class: 's' }, "'Hello, world'"), ')'),
          el('div', { style: { marginTop: '10px' }, class: 'c' }, '# and later, something useful'),
          el('div', {}, el('span', { class: 'k' }, 'for'), ' line ', el('span', { class: 'k' }, 'in'),
            ' handle:'),
          el('div', {}, '    ', el('span', { class: 'k' }, 'if'), ' line.startswith(',
            el('span', { class: 's' }, "'From'"), '):'),
          el('div', {}, '        ', el('span', { class: 'f' }, 'print'), '(line)')),
        el('div', { class: 'meta-row', style: { marginTop: 'var(--s-4)' } },
          el('span', {}, icon('book', 13), `${course.stats.chapters} chapters`),
          el('span', { class: 'sep' }, '·'),
          el('span', {}, icon('video', 13), `${course.stats.videos} videos`),
          el('span', { class: 'sep' }, '·'),
          el('span', {}, icon('code', 13), `${course.stats.code_files} sample files`)))));
}

function statStrip(stats) {
  return el('div', { class: 'stat-strip' },
    el('div', { class: 'stat-strip-inner' },
      statTile(String(stats.lessons), 'Lessons'),
      statTile(fmtNum(stats.words), 'Words to read'),
      statTile(String(stats.videos), 'Video lectures'),
      statTile(fmtTime(stats.seconds), 'Watch time'),
      statTile(String(stats.slides), 'Lecture slides'),
      statTile(String(stats.code_files), 'Runnable samples')));
}

function continueCard(progress) {
  const next = state.course.lessons.find((l) => !lessonProgress(l.slug).done)
    || state.course.lessons[state.course.lessons.length - 1];
  const p = lessonProgress(next.slug);
  return el('section', { class: 'card card-pad-lg', style: { marginTop: 'var(--s-6)' } },
    el('div', { class: 'row-between wrap', style: { gap: 'var(--s-5)' } },
      el('div', { style: { minWidth: '16rem' } },
        el('p', { class: 'eyebrow' }, 'Pick up where you left off'),
        el('h2', { style: { fontSize: 'var(--fs-2xl)', marginTop: 'var(--s-2)' } },
          `Lesson ${next.number}: ${next.name}`),
        el('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' } },
          next.description)),
      el('div', { class: 'row', style: { gap: 'var(--s-5)' } },
        el('div', { class: 'ring', style: { '--pct': progress.percent } },
          el('span', {}, `${progress.percent}%`)),
        el('a', { class: 'btn btn-primary', href: `/lesson/${next.slug}` },
          p.percent > 0 ? 'Continue' : 'Begin', icon('arrowRight', 15)))));
}

function videoStrip(course) {
  const first = course.lessons.find((l) => l.videos.length);
  const videos = [];
  for (const lesson of course.lessons) {
    for (const v of lesson.videos) {
      if (videos.length >= 6) break;
      videos.push({ lesson, video: v });
    }
    if (videos.length >= 6) break;
  }
  return el('div', { class: 'grid grid-2' },
    ...videos.map(({ lesson, video }) => el('div', { class: 'card card-pad' },
      videoCard(video, {
        lesson,
        onSelect: () => navigate(`/lesson/${lesson.slug}?tab=videos&v=${video.video_id}`),
      }),
      el('div', { style: { marginTop: 'var(--s-2)', paddingLeft: 'var(--s-3)' } },
        el('a', {
          href: `/lesson/${lesson.slug}`,
          style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-3)' },
        }, `Lesson ${lesson.number} · ${lesson.name}`)))));
}

function chapterGrid(course) {
  const chapters = course.chapters;
  return el('div', { class: 'grid grid-3' },
    ...chapters.map((chapter) => {
      const lesson = course.lessons.find((l) => l.chapter === chapter.slug);
      const sections = (chapter.toc || []).filter((t) => t.level === 2).slice(0, 4);
      return el('a', { class: 'card card-link chapter-card', href: `/read/${chapter.slug}` },
        el('div', { class: 'row-between' },
          el('span', { class: 'cn' }, `CHAPTER ${chapterNumber(chapter.slug)}`),
          el('span', { class: 'muted', style: { fontSize: 'var(--fs-3xs)' } },
            `${fmtNum(chapter.words)} words`)),
        el('h3', {}, chapter.title),
        el('ul', {}, ...sections.map((s) => el('li', {}, el('span', {}, s.text)))));
    }));
}

function chapterNumber(slug) {
  const i = state.course.chapters.findIndex((c) => c.slug === slug);
  return i >= 0 ? i + 1 : '·';
}

function practiceCard(iconName, title, body, href) {
  return el('a', { class: 'card card-link card-pad-lg', href },
    el('div', {
      class: 'avatar',
      style: { marginBottom: 'var(--s-4)', width: '38px', height: '38px' },
    }, icon(iconName, 18)),
    el('h3', { style: { fontSize: 'var(--fs-lg)', marginBottom: 'var(--s-2)' } }, title),
    el('p', { style: { fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } }, body));
}

function footerCopy() {
  return el('div', { class: 'page', style: { paddingTop: 0 } },
    el('div', { class: 'callout', style: { maxWidth: '72ch' } },
      icon('info', 18),
      el('div', {},
        el('strong', {}, 'About this copy. '),
        'The text of the book is by Dr. Charles R. Severance and is licensed CC BY-NC-SA 4.0. '
        + 'Video lectures are hosted on YouTube and played in an embedded player. '
        + 'Everything else — the slides, figures, sample programs and data files — is served from '
        + 'this website, ready to read without additional downloads.')));
}
