/* views/lesson.js — one lesson: videos, slides, the matching book chapter and
   its exercises, gathered on a single page. */

import {
  el, icon, fmtTime, navigate, toast, youtubeEmbed, titleCase, onLeaveView,
} from '../core.js';
import { api } from '../api.js';
import {
  state, idx, lessonProgress, isVideoWatched, markVideoWatched, setLessonDone,
  setLessonRead, neighbours, exerciseState, saveExercise, subscribe, GUIDED_LESSON,
} from '../data.js';
import {
  renderFooter, crumbs, metaRow, emptyState, videoCard,
  deckViewer, enhanceChapterCode, watchToggle,
} from '../components.js';
import { guideCard } from './setup.js';

function guideCount() { return (state.course.guides || []).length; }

function guidesReadCount() { return guideProgress().guides; }

function guideProgress() { return lessonProgress(GUIDED_LESSON); }

/** Only the tabs that actually have something behind them. */
function availableTabs(lesson, chapterSummary) {
  // lesson 1 has no lecture, no slides, no chapter and no exercises: the setup
  // guides are its entire content, so it gets a shorter tab strip
  if (lesson.slug === GUIDED_LESSON && guideCount()) return ['overview', 'setup'];
  const names = ['overview'];
  if (lesson.videos.length) names.push('videos');
  if (lesson.deck) names.push('slides');
  if (chapterSummary) names.push('reading');
  names.push('practice');
  return names;
}

export function renderLesson(view, params, query) {
  const lesson = idx.lessonBySlug.get(params.slug);
  if (!lesson) {
    view.replaceChildren(
      el('div', { class: 'page page-narrow' },
        emptyState('No such lesson', `There is no lesson called “${params.slug}”.`,
          el('a', { class: 'btn btn-primary', href: '/syllabus' }, 'Back to the syllabus'))),
      renderFooter());
    return;
  }

  const chapterSummary = lesson.chapter ? idx.chapterBySlug.get(lesson.chapter) : null;
  const tabs = availableTabs(lesson, chapterSummary);
  const requested = query.get('tab');
  const tab = tabs.includes(requested) ? requested : 'overview';

  const body = el('div', { class: 'lesson-body' });

  const paint = () => {
    view.replaceChildren(
      lessonHero(lesson, tab, chapterSummary),
      body,
      renderFooter());
    paintTab(body, lesson, tab, query, chapterSummary);
  };

  paint();

  // re-render the aside (and the guide badges) whenever progress changes
  const unsubscribe = subscribe((_, reason) => {
    if (reason !== 'progress') return;
    if (tab === 'setup') void paintTab(body, lesson, tab, query, chapterSummary);
    else {
      const aside = view.querySelector('.lesson-aside');
      if (aside) aside.replaceWith(lessonAside(lesson, tab, chapterSummary));
    }
  });
  onLeaveView(unsubscribe);
}

/* ------------------------------------------------------------------- hero */

function lessonHero(lesson, tab, chapterSummary) {
  const p = lessonProgress(lesson.slug);
  const { prev, next } = neighbours(lesson.slug);

  return el('div', { class: 'lesson-hero' },
    el('div', { class: 'lesson-hero-inner' },
      crumbs([
        { label: 'Overview', href: '/' },
        { label: 'Syllabus', href: '/syllabus' },
        { label: `Lesson ${lesson.number}` },
      ]),
      el('div', { class: 'row', style: { marginTop: 'var(--s-3)' } },
        el('span', { class: 'badge badge-accent' }, `Lesson ${String(lesson.number).padStart(2, '0')}`),
        p.done ? el('span', { class: 'badge badge-ok' }, icon('check', 11), 'Completed') : null,
        p.percent > 0 && !p.done ? el('span', { class: 'badge badge-warm' }, `${p.percent}% complete`) : null),
      el('h1', {}, lesson.name),
      el('p', { class: 'lede' }, lesson.description),
      el('div', { class: 'row-between wrap', style: { marginTop: 'var(--s-5)', gap: 'var(--s-4)' } },
        metaRow(
          lesson.slug === GUIDED_LESSON && guideCount() ? el('a', {
            href: '/setup', class: 'row', style: { gap: '0.35em' },
          }, icon('download', 14), `${guideCount()} setup guides`) : null,
          lesson.videos.length ? el('span', { class: 'row', style: { gap: '0.35em' } },
            icon('video', 14), `${lesson.videos.length} videos · ${fmtTime(lesson.duration_seconds)}`) : null,
          lesson.deck_page_count ? el('span', { class: 'row', style: { gap: '0.35em' } },
            icon('slides', 14), `${lesson.deck_page_count} slides`) : null,
          chapterSummary ? el('a', { href: `/read/${chapterSummary.slug}`, class: 'row', style: { gap: '0.35em' } },
            icon('book', 14), `Chapter ${chapterSummary.slug.slice(0, 2)} · ${chapterSummary.title}`) : null),
        el('div', { class: 'row' },
          prev ? el('a', {
            class: 'btn btn-quiet btn-sm', href: `/lesson/${prev.slug}`,
            'data-tip': `Lesson ${prev.number}: ${prev.name}`,
          }, icon('arrowLeft', 14), 'Previous') : null,
          next ? el('a', {
            class: 'btn btn-outline btn-sm', href: `/lesson/${next.slug}`,
          }, 'Next lesson', icon('arrowRight', 14)) : null)),
      lessonTabs(lesson, tab, chapterSummary)));
}

function lessonTabs(lesson, tab, chapterSummary) {
  const counts = {
    setup: guideCount(),
    videos: lesson.videos.length,
    slides: lesson.deck_page_count,
    reading: lesson.chapter ? 1 : 0,
  };
  const strip = el('div', { class: 'tabs', style: { marginTop: 'var(--s-5)', borderBottom: 'none' } });
  for (const name of availableTabs(lesson, chapterSummary)) {
    const btn = el('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': tab === name ? 'true' : 'false',
      onclick: () => navigate(`/lesson/${lesson.slug}?tab=${name}`),
    }, titleCase(name === 'reading' ? 'reading' : name));
    if (counts[name]) btn.append(el('span', { class: 'count' }, String(counts[name])));
    strip.append(btn);
  }
  return strip;
}

/* -------------------------------------------------------------- tab router */

async function paintTab(body, lesson, tab, query, chapterSummary) {
  body.replaceChildren(
    el('div', { class: 'lesson-main' }, loadingBlock()),
    lessonAside(lesson, tab, chapterSummary));

  try {
    switch (tab) {
      case 'setup': paintSetup(body, lesson); break;
      case 'videos': await paintVideos(body, lesson, query); break;
      case 'slides': await paintSlides(body, lesson); break;
      case 'reading': await paintReading(body, lesson, chapterSummary); break;
      case 'practice': await paintPractice(body, lesson, chapterSummary); break;
      default: await paintOverview(body, lesson, chapterSummary);
    }
  } catch (err) {
    const main = body.querySelector('.lesson-main');
    if (main) {
      main.replaceChildren(emptyState('Could not load this section', err.message || String(err),
        el('a', { class: 'btn btn-outline', href: `/lesson/${lesson.slug}` }, 'Reload the lesson')));
    }
  }
}

function loadingBlock() {
  return el('div', { class: 'stack-lg' },
    el('div', { class: 'skeleton', style: { height: '2.4rem', width: '40%' } }),
    el('div', { class: 'skeleton', style: { height: '14rem' } }),
    el('div', { class: 'skeleton', style: { height: '7rem' } }));
}

function main(body, ...nodes) {
  const mount = body.querySelector('.lesson-main') || body;
  mount.replaceChildren(...nodes);
  return mount;
}

/* ---------------------------------------------------------------- overview */

async function paintOverview(body, lesson, chapterSummary) {
  const p = lessonProgress(lesson.slug);
  const chapter = chapterSummary ? await loadChapter(chapterSummary.slug).catch(() => null) : null;
  const objectives = chapter
    ? chapter.toc.filter((t) => t.level === 2).slice(0, 8)
    : [];

  const blocks = [];

  blocks.push(el('section', {},
    el('h2', { class: 'section-title' }, 'What this lesson covers'),
    el('p', { style: { fontSize: 'var(--fs-lg)', color: 'var(--ink-2)', lineHeight: '1.62' } },
      lesson.description),
    objectives.length
      ? el('div', { class: 'tag-list', style: { marginTop: 'var(--s-5)' } },
          ...objectives.map((o) => el('a', {
            class: 'pill', href: `/read/${chapterSummary.slug}#${o.id}`,
          }, o.text)))
      : null));

  blocks.push(el('section', { style: { marginTop: 'var(--s-8)' } },
    el('h2', { class: 'section-title' }, 'Everything in this lesson'),
    el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' } },
      lesson.slug === GUIDED_LESSON && guideCount()
        ? pathCard('download', 'Setup guides',
          `${guideCount()} guides · installing Python`,
          `${guidesReadCount()} of ${guideCount()} read`,
          Math.round((guidesReadCount() / guideCount()) * 100),
          `/lesson/${lesson.slug}?tab=setup`)
        : null,
      lesson.videos.length ? pathCard('video', 'Lecture videos',
        `${lesson.videos.length} clips · ${fmtTime(lesson.duration_seconds)}`,
        p.videosTotal ? `${p.videos} of ${p.videosTotal} watched` : null,
        p.videosTotal ? Math.round((p.videos / p.videosTotal) * 100) : 0,
        `/lesson/${lesson.slug}?tab=videos`) : null,
      lesson.deck_page_count ? pathCard('slides', 'Lecture slides',
        `${lesson.deck_page_count} slides`,
        p.slidesTotal ? `${p.slides} of ${p.slidesTotal} seen` : null,
        p.slidesTotal ? Math.round((p.slides / p.slidesTotal) * 100) : 0,
        `/lesson/${lesson.slug}?tab=slides`) : null,
      chapterSummary ? pathCard('book', 'Book chapter',
        chapterSummary.title,
        p.read ? 'Marked as read' : null,
        p.read ? 100 : 0,
        `/lesson/${lesson.slug}?tab=reading`) : null,
      lesson.chapter || lesson.tools.length || lesson.discussions.length
        ? pathCard('flask', 'Exercises',
          'Practice problems from the chapter',
          null, 0,
          `/lesson/${lesson.slug}?tab=practice`)
        : null)));

  if (lesson.videos.length) {
    const first = lesson.videos[0];
    blocks.push(el('section', { style: { marginTop: 'var(--s-8)' } },
      el('div', { class: 'row-between wrap', style: { marginBottom: 'var(--s-4)' } },
        el('h2', { class: 'section-title' }, 'Start watching'),
        el('a', { class: 'btn btn-outline btn-sm', href: `/lesson/${lesson.slug}?tab=videos` },
          'All videos', icon('arrowRight', 14))),
      el('div', { class: 'player-shell' },
        el('iframe', {
          src: youtubeEmbed(first.video_id),
          title: first.title,
          allow: 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
          allowfullscreen: '',
          loading: 'lazy',
        })),
      el('p', { style: { marginTop: 'var(--s-3)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } },
        `${first.title}${first.duration ? ` · ${first.duration}` : ''}`)));
  }

  main(body, ...blocks);
}

function pathCard(iconName, title, subtitle, status, percent, href) {
  return el('a', { class: 'card card-link card-pad', href },
    el('div', { class: 'row-between', style: { marginBottom: 'var(--s-3)' } },
      el('span', { class: 'avatar', style: { width: '30px', height: '30px' } }, icon(iconName, 15)),
      percent >= 100 ? el('span', { class: 'badge badge-ok' }, 'done') : null),
    el('h3', { style: { fontSize: 'var(--fs-base)', marginBottom: 'var(--s-1)' } }, title),
    el('div', { style: { fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } }, subtitle),
    status ? el('div', { style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)', marginTop: 'var(--s-1)' } }, status) : null,
    percent > 0 && percent < 100
      ? el('div', { class: 'bar bar-thin', style: { marginTop: 'var(--s-3)' } },
          el('span', { style: { width: `${percent}%` } }))
      : null);
}

/* ------------------------------------------------------------------- setup */

function paintSetup(body, lesson) {
  const guides = state.course.guides || [];
  const gp = guideProgress();

  main(body,
    el('section', {},
      el('div', { class: 'row-between wrap', style: { marginBottom: 'var(--s-5)', gap: 'var(--s-4)' } },
        el('div', {},
          el('h2', { class: 'section-title' }, 'Installing Python'),
          el('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } },
            'Lesson 1 is the only one with no lecture: it is the setup step. Read the guide '
            + 'that matches your computer, and the rest of the course will run on it.')),
        el('span', { class: `badge ${gp.guides === guides.length ? 'badge-ok' : 'badge-plain'}` },
          `${gp.guides} of ${guides.length} read`)),
      el('div', { class: 'grid grid-2' },
        ...guides.map((g, i) => guideCard(g, i)))),

    el('section', { style: { marginTop: 'var(--s-8)' } },
      el('h2', { class: 'section-title' }, 'Or skip the installation'),
      el('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-4)' } },
        'Nothing in this course requires you to install anything. The book, the slides and every '
        + 'sample program are already here, and the playground runs Python in your browser for you.'),
      el('div', { class: 'grid grid-3' },
        el('a', { class: 'card card-link card-pad', href: '/playground' },
          el('span', { class: 'avatar', style: { width: '30px', height: '30px' } }, icon('terminal', 15)),
          el('h3', { style: { fontSize: 'var(--fs-base)', margin: 'var(--s-3) 0 var(--s-1)' } }, 'Playground'),
          el('div', { style: { fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } },
            'Write and run Python in the browser')),
        el('a', { class: 'card card-link card-pad', href: '/library' },
          el('span', { class: 'avatar', style: { width: '30px', height: '30px' } }, icon('code', 15)),
          el('h3', { style: { fontSize: 'var(--fs-base)', margin: 'var(--s-3) 0 var(--s-1)' } }, 'Code library'),
          el('div', { style: { fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } },
            'Every sample file from the book, ready to run')),
        el('a', { class: 'card card-link card-pad', href: '/read' },
          el('span', { class: 'avatar', style: { width: '30px', height: '30px' } }, icon('book', 15)),
          el('h3', { style: { fontSize: 'var(--fs-base)', margin: 'var(--s-3) 0 var(--s-1)' } }, 'Start reading'),
          el('div', { style: { fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } },
            'Chapter 1 needs no setup at all')))));
}

/* ------------------------------------------------------------------ videos */

async function paintVideos(body, lesson, query) {
  if (!lesson.videos.length) {
    return main(body, emptyState('No videos in this lesson',
      'This lesson is text only — open the reading tab instead.'));
  }
  const requested = query.get('v');
  let current = lesson.videos.find((v) => v.video_id === requested) || lesson.videos[0];

  const shell = el('div', { class: 'player-shell' });
  const caption = el('div', { style: { marginTop: 'var(--s-3)' } });
  const list = el('div', { class: 'stack', style: { marginTop: 'var(--s-5)' } });

  const paintPlayer = () => {
    shell.replaceChildren(el('iframe', {
      src: youtubeEmbed(current.video_id, { autoplay: true }),
      title: current.title,
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
      allowfullscreen: '',
    }));
    caption.replaceChildren(
      el('div', { class: 'row-between wrap', style: { gap: 'var(--s-3)' } },
        el('div', {},
          el('h2', { style: { fontSize: 'var(--fs-xl)' } }, current.title),
          metaRow(
            current.duration ? el('span', {}, current.duration) : null,
            el('span', {}, `${lesson.videos.indexOf(current) + 1} of ${lesson.videos.length}`))),
        el('div', { class: 'row' },
          watchToggle(lesson, current),
          el('a', {
            class: 'btn btn-quiet btn-sm',
            href: `https://www.youtube.com/watch?v=${current.video_id}`,
            target: '_blank', rel: 'noopener', 'data-external': '1',
          }, icon('external', 14), 'YouTube'))));
  };

  const paintList = () => {
    list.replaceChildren(
      el('h3', { style: { fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', marginBottom: 'var(--s-2)' } },
        `${lesson.videos.length} videos in this lesson`),
      ...lesson.videos.map((v) => videoCard(v, {
        lesson,
        current: current.video_id,
        onSelect: (picked) => {
          current = picked;
          paintPlayer();
          paintList();
          markVideoWatched(lesson.slug, picked.video_id);
          navigate(`/lesson/${lesson.slug}?tab=videos&v=${picked.video_id}`, { keepScroll: true });
        },
      })));
  };

  paintPlayer();
  paintList();
  main(body,
    el('section', {}, shell, caption),
    el('section', {}, list));
  if (!isVideoWatched(lesson.slug, current.video_id)) {
    markVideoWatched(lesson.slug, current.video_id);
  }
}

/* ------------------------------------------------------------------ slides */

async function paintSlides(body, lesson) {
  if (!lesson.deck) {
    return main(body, emptyState('No slide deck for this lesson',
      'This lesson has no lecture slides of its own.'));
  }
  const summary = idx.deckBySlug.get(lesson.deck);
  const deck = await api.deck(lesson.deck);
  // resume at the furthest slide this learner has already seen
  const seenPages = (state.progress.lessons[lesson.slug] || {}).slides || [];
  const startPage = seenPages.length ? Math.max(...seenPages) : 1;

  main(body,
    el('section', {},
      el('div', { class: 'row-between wrap', style: { marginBottom: 'var(--s-4)' } },
        el('div', {},
          el('h2', { class: 'section-title' }, `${deck.page_count} slides`),
          el('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)' } },
            'Use ← and → to page through. Slides you have seen are marked in the rail.')),
        el('div', { class: 'row' },
          el('a', { class: 'btn btn-outline btn-sm', href: `/static/${deck.pdf}`, download: '' },
            icon('download', 14), 'PDF'),
          deck.pptx ? el('a', { class: 'btn btn-outline btn-sm', href: `/static/${deck.pptx}`, download: '' },
            icon('download', 14), 'PPTX') : null)),
      deckViewer(deck, { lessonSlug: lesson.slug, startPage })));
}

/* ----------------------------------------------------------------- reading */

async function paintReading(body, lesson, chapterSummary) {
  if (!chapterSummary) {
    return main(body, emptyState('No chapter for this lesson',
      'This lesson is not tied to a chapter of the book.'));
  }
  const chapter = await loadChapter(chapterSummary.slug);
  const holder = el('div', { class: 'book', html: chapter.html });
  await inlineAssets(holder);
  enhanceChapterCode(holder, { chapterSlug: chapter.slug });

  const foot = el('div', { class: 'reader-foot' },
    el('button', {
      class: 'btn btn-outline',
      onclick: () => {
        const nowRead = !lessonProgress(lesson.slug).read;
        setLessonRead(lesson.slug, nowRead);
        toast(nowRead ? 'Marked as read' : 'Marked unread', 'ok', 1500);
      },
    }, icon('check', 15), 'Mark chapter as read'),
    el('a', { class: 'btn btn-ghost', href: `/read/${chapter.slug}` },
      'Open in full reader', icon('arrowUpRight', 14)));

  main(body,
    el('div', { class: 'row-between wrap', style: { marginBottom: 'var(--s-5)' } },
      el('div', {},
        el('p', { class: 'eyebrow' }, `Chapter ${chapter.slug.slice(0, 2)}`),
        el('h2', { class: 'section-title', style: { marginTop: 'var(--s-2)' } }, chapter.title)),
      el('span', { class: 'badge badge-plain' }, `${chapter.words.toLocaleString()} words`)),
    holder,
    foot);
}

let chapterCache = new Map();

async function loadChapter(slug) {
  if (!chapterCache.has(slug)) {
    chapterCache.set(slug, api.chapter(slug));
  }
  return chapterCache.get(slug);
}

/**
 * The book's figures are authored for a printed page: several carry an inline
 * `height: 2.5in` that looks cramped on screen. Strip those so our CSS can
 * size them, and flag anything that 404s so it does not leave a broken box.
 */
async function inlineAssets(root) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((img) => new Promise((resolve) => {
    img.style.height = '';
    img.addEventListener('error', () => {
      const fig = img.closest('figure');
      (fig || img).replaceWith(el('div', { class: 'callout', style: { margin: '1.5em 0' } },
        icon('warn', 18),
        el('div', {}, `Figure unavailable: ${img.getAttribute('src')}`)));
      resolve();
    }, { once: true });
    img.addEventListener('load', resolve, { once: true });
    if (img.complete) resolve();
  })));
  return root;
}

/* ---------------------------------------------------------------- practice */

async function paintPractice(body, lesson, chapterSummary) {
  const chapter = chapterSummary ? await loadChapter(chapterSummary.slug).catch(() => null) : null;
  const exercises = chapter ? extractExercises(chapter) : [];

  const blocks = [];

  if (exercises.length) {
    blocks.push(el('section', {},
      el('h2', { class: 'section-title' }, `${exercises.length} exercises`),
      el('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-5)' } },
        'Written for this chapter. Solve them in the playground — the data files the exercises '
        + 'need are already there.'),
      el('div', { class: 'stack-lg' },
        ...exercises.map((ex, i) => exerciseCard(lesson, chapter, ex, i + 1)))));
  } else {
    blocks.push(emptyState('No written exercises in this chapter',
      'This chapter ends without practice problems. Try the sample programs for it in the code library.',
      el('a', { class: 'btn btn-outline', href: '/library' }, 'Open the code library')));
  }

  // the original course tools (autograder, quizzes) need a login on py4e.com
  if (lesson.tools.length || lesson.discussions.length) {
    blocks.push(el('section', { style: { marginTop: 'var(--s-8)' } },
      el('h2', { class: 'section-title' }, 'On py4e.com'),
      el('p', { class: 'muted', style: { fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-4)' } },
        'The autograder and chapter quizzes run on the original course site and need a free account there.'),
      el('div', { class: 'grid grid-2' },
        ...[...lesson.tools, ...lesson.discussions].map((tool) => el('a', {
          class: 'card card-link card-pad',
          href: tool.url.startsWith('http') ? tool.url : `https://www.py4e.com${tool.url}`,
          target: '_blank', rel: 'noopener', 'data-external': '1',
        },
        el('div', { class: 'row-between' },
          el('div', {},
            el('h3', { style: { fontSize: 'var(--fs-base)', marginBottom: 'var(--s-1)' } }, tool.title),
            el('div', { style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)' } },
              tool.kind === 'tool' ? 'Autograder / quiz' : 'Discussion')),
          icon('arrowUpRight', 15)))))));
  }

  main(body, ...blocks);
}

function extractExercises(chapter) {
  const holder = document.createElement('div');
  holder.innerHTML = chapter.html;
  const heading = Array.from(holder.querySelectorAll('h2'))
    .find((h) => /^exercises?$/i.test(h.textContent.trim()));
  if (!heading) return [];
  const out = [];
  let node = heading.nextElementSibling;
  let bucket = { title: heading.textContent.trim(), blocks: [] };
  while (node && node.tagName !== 'H2') {
    if (node.tagName === 'P' || node.tagName === 'UL' || node.tagName === 'OL' || node.tagName === 'PRE') {
      bucket.blocks.push(node.outerHTML);
    }
    node = node.nextElementSibling;
  }
  if (bucket.blocks.length) out.push(bucket);
  return out;
}

function exerciseCard(lesson, chapter, bucket, index) {
  const id = `${chapter.slug}:${index}`;
  const saved = exerciseState(id);
  const holder = el('div', { class: 'book', html: bucket.blocks.join('') });
  enhanceChapterCode(holder, { chapterSlug: chapter.slug });

  const foot = el('div', { class: 'row-between wrap', style: { marginTop: 'var(--s-4)' } },
    el('div', { class: 'row' },
      el('span', {
        class: `badge ${saved && saved.passed ? 'badge-ok' : 'badge-plain'}`,
      }, saved && saved.passed ? 'Solved' : 'Not solved'),
      saved && saved.code ? el('span', { class: 'muted', style: { fontSize: 'var(--fs-2xs)' } },
        `${saved.code.split('\n').length} lines saved`) : null),
    el('div', { class: 'row' },
      el('a', { class: 'btn btn-outline btn-sm', href: `/playground?sample=${chapter.slug}` },
        icon('terminal', 14), 'Open playground'),
      el('button', {
        class: `btn btn-sm ${saved && saved.passed ? 'btn-outline' : 'btn-primary'}`,
        onclick: (e) => {
          const now = !(saved && saved.passed);
          saveExercise(id, { passed: now });
          const btn = e.currentTarget;
          btn.textContent = now ? 'Solved' : 'Mark solved';
          btn.className = `btn btn-sm ${now ? 'btn-outline' : 'btn-primary'}`;
          toast(now ? 'Nice — marked as solved' : 'Marked unsolved', now ? 'ok' : '', 1500);
        },
      }, saved && saved.passed ? 'Solved' : 'Mark solved')));

  return el('article', { class: 'card card-pad-lg', id },
    el('div', { class: 'row-between', style: { marginBottom: 'var(--s-3)' } },
      el('span', { class: 'num', style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-4)' } },
        `EXERCISE ${index}`)),
    holder,
    foot);
}

/* ------------------------------------------------------------------- aside */

function lessonAside(lesson, tab, chapterSummary) {
  const p = lessonProgress(lesson.slug);
  const { prev, next } = neighbours(lesson.slug);

  const items = [];
  items.push(asideLink(`/lesson/${lesson.slug}?tab=overview`, 'Overview', tab === 'overview'));
  if (lesson.slug === GUIDED_LESSON && guideCount()) {
    items.push(asideLink(`/lesson/${lesson.slug}?tab=setup`, 'Installing Python',
      tab === 'setup', `${guidesReadCount()}/${guideCount()}`));
  }
  if (lesson.videos.length) {
    items.push(asideLink(`/lesson/${lesson.slug}?tab=videos`, 'Videos',
      tab === 'videos', `${p.videos}/${p.videosTotal}`));
  }
  if (lesson.deck) {
    items.push(asideLink(`/lesson/${lesson.slug}?tab=slides`, 'Slides',
      tab === 'slides', `${p.slides}/${p.slidesTotal}`));
  }
  if (chapterSummary) {
    items.push(asideLink(`/lesson/${lesson.slug}?tab=reading`, 'Read the chapter',
      tab === 'reading', p.read ? '✓' : null));
  }
  if (lesson.chapter || lesson.tools.length || lesson.discussions.length) {
    items.push(asideLink(`/lesson/${lesson.slug}?tab=practice`, 'Exercises', tab === 'practice'));
  }

  const outline = [];
  if (chapterSummary && chapterSummary.toc) {
    for (const entry of chapterSummary.toc.filter((t) => t.level === 2).slice(0, 10)) {
      outline.push(el('a', {
        href: `/read/${chapterSummary.slug}#${entry.id}`,
      }, entry.text));
    }
  }

  return el('aside', { class: 'lesson-aside' },
    el('div', { class: 'aside-card' },
      el('div', { class: 'row-between', style: { marginBottom: 'var(--s-4)' } },
        el('div', { class: 'ring', style: { '--pct': p.percent } }, el('span', {}, `${p.percent}%`)),
        el('div', { style: { textAlign: 'right' } },
          el('div', { style: { fontSize: 'var(--fs-2xs)', color: 'var(--ink-3)' } }, 'Lesson progress'),
          el('div', { style: { fontSize: 'var(--fs-xs)', fontWeight: '600' } },
            p.done ? 'Completed'
              : lesson.slug === GUIDED_LESSON && p.guidesTotal
                ? `${p.guides}/${p.guidesTotal} guides read`
                : `${p.videos}/${p.videosTotal} watched`))),
      el('button', {
        class: `btn btn-block ${p.done ? 'btn-outline' : 'btn-primary'}`,
        onclick: () => {
          setLessonDone(lesson.slug, !p.done);
          toast(p.done ? 'Marked incomplete' : 'Lesson complete', p.done ? '' : 'ok', 1600);
        },
      }, icon('check', 15), p.done ? 'Mark incomplete' : 'Mark lesson complete')),

    el('div', { class: 'aside-card' },
      el('h4', {}, 'In this lesson'),
      el('div', { class: 'aside-list' }, ...items)),

    outline.length ? el('div', { class: 'aside-card' },
      el('h4', {}, 'Chapter sections'),
      el('div', { class: 'aside-list' }, ...outline.map((a) => a))) : null,

    el('div', { class: 'aside-card' },
      el('h4', {}, 'Jump to'),
      el('div', { class: 'aside-list' },
        prev ? el('a', { href: `/lesson/${prev.slug}` },
          el('span', { class: 'idx' }, '←'),
          el('span', { class: 'truncate' }, `${prev.number}. ${prev.name}`)) : null,
        next ? el('a', { href: `/lesson/${next.slug}` },
          el('span', { class: 'idx' }, '→'),
          el('span', { class: 'truncate' }, `${next.number}. ${next.name}`)) : null,
        el('a', { href: '/syllabus' },
          el('span', { class: 'idx' }, icon('list', 13)),
          el('span', {}, 'All lessons')))));
}

function asideLink(href, label, active, badge) {
  return el('a', { href, 'aria-current': active ? 'true' : null },
    el('span', { class: 'grow' }, label),
    badge ? el('span', { class: 'num', style: { fontSize: 'var(--fs-3xs)', color: 'var(--ink-4)' } },
      badge) : null);
}
