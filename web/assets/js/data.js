import { BASE_PATH } from './runtime.js';
import { toast, t } from './core.js';
/* data.js — one place that owns course content and learner progress.
   Views subscribe instead of fetching for themselves, so a progress change
   repaints every badge on screen without a reload. */

import { api } from './api.js';
import { store } from './core.js';

/* ------------------------------------------------------------------ state */

const listeners = new Set();
const localKey = `progress-cache:${BASE_PATH}`;

export const state = {
  course: null,          // /api/course payload
  progress: {
    lessons: {}, exercises: {}, bookmarks: [], notes: {}, streak: { days: [], last: null },
  },
  ready: false,
  runnerReady: false,
};

/** Indices built once the course payload arrives. */
export const idx = {
  lessonBySlug: new Map(),
  chapterBySlug: new Map(),
  deckBySlug: new Map(),
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) {
    try { fn(state, reason); } catch (err) { console.error(err); }
  }
  document.dispatchEvent(new CustomEvent('statechange', { detail: { reason } }));
}

/* ------------------------------------------------------------------ loading */

let loadPromise = null;

export function loadCourse() {
  if (loadPromise) return loadPromise;
  loadPromise = api.course().then((course) => {
    state.course = course;
    idx.lessonBySlug.clear();
    idx.chapterBySlug.clear();
    idx.deckBySlug.clear();
    for (const l of course.lessons || []) idx.lessonBySlug.set(l.slug, l);
    for (const c of course.chapters || []) idx.chapterBySlug.set(c.slug, c);
    for (const d of course.decks || []) idx.deckBySlug.set(d.slug, d);
    course.lessons = [...(course.lessons || [])].sort((a, b) => (a.number || 0) - (b.number || 0));
    document.title = t(course.title);
    emit('course');
    return course;
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

export async function loadProgress() {
  // optimistic local copy first so the UI can paint immediately
  const cached = store.get(localKey);
  if (cached) { state.progress = mergeProgress(state.progress, cached); emit('progress'); }
  try {
    const remote = await api.progress();
    state.progress = mergeProgress(state.progress, remote);
    store.set(localKey, state.progress);
    emit('progress');
  } catch {
    /* offline or endpoint missing: the local copy stands in */
  }
  return state.progress;
}

function mergeProgress(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  return {
    lessons: { ...(base.lessons || {}), ...(patch.lessons || {}) },
    exercises: { ...(base.exercises || {}), ...(patch.exercises || {}) },
    bookmarks: Array.isArray(patch.bookmarks) ? patch.bookmarks : (base.bookmarks || []),
    notes: { ...(base.notes || {}), ...(patch.notes || {}) },
    streak: patch.streak || base.streak || { days: [], last: null },
  };
}

/* ------------------------------------------------------------------ progress */

/** Apply a patch locally, then persist (locally always, remotely best-effort). */
export function patchProgress(patch) {
  applyLocally(patch);
  store.set(localKey, state.progress);
  emit('progress');
  return api.saveProgress(patch)
    .then((remote) => {
      state.progress = mergeProgress(state.progress, remote);
      store.set(localKey, state.progress);
      emit('progress');
      return remote;
    })
    .catch((err) => { toast(`Progress could not be saved: ${err.message}`, '', 5000); return null; });
}

function applyLocally(patch) {
  const p = state.progress;
  if (patch.reset) {
    state.progress = { lessons: {}, exercises: {}, bookmarks: [], notes: {}, streak: { days: [], last: null } };
    return;
  }
  if (patch.lesson) {
    const { slug, videos, slides, guides, read, done } = patch.lesson;
    const entry = p.lessons[slug] || (p.lessons[slug] = {
      videos: [], slides: [], guides: [], read: false, done: false,
    });
    entry.videos = entry.videos || [];
    entry.slides = entry.slides || [];
    entry.guides = entry.guides || [];
    for (const v of videos || []) if (!entry.videos.includes(v)) entry.videos.push(v);
    for (const s of slides || []) if (!entry.slides.includes(s)) entry.slides.push(s);
    for (const g of guides || []) if (!entry.guides.includes(g)) entry.guides.push(g);
    if (read !== undefined) entry.read = !!read;
    if (done !== undefined) entry.done = !!done;
    entry.updated = Date.now() / 1000;
  }
  if (patch.exercise) {
    const { id, passed, code } = patch.exercise;
    const entry = p.exercises[id] || (p.exercises[id] = {});
    if (passed !== undefined) entry.passed = !!passed;
    if (code !== undefined) entry.code = code;
    entry.updated = Date.now() / 1000;
  }
  if (patch.note) {
    p.notes[patch.note.chapter] = patch.note.text;
  }
  if (patch.bookmark) {
    const { chapter, anchor, title } = patch.bookmark;
    const i = p.bookmarks.findIndex((b) => b.chapter === chapter && b.anchor === anchor);
    if (i >= 0) p.bookmarks.splice(i, 1);
    else p.bookmarks.unshift({ chapter, anchor, title, at: Date.now() / 1000 });
  }
}

/* --------------------------------------------------------- derived selectors */

export function lessonProgress(slug) {
  const entry = state.progress.lessons[slug] || {};
  const lesson = idx.lessonBySlug.get(slug);
  const totalVideos = lesson ? lesson.videos.length : 0;
  const watched = (entry.videos || []).length;
  const deckPages = lesson ? lesson.deck_page_count || 0 : 0;
  const seen = (entry.slides || []).length;
  const totalGuides = slug === GUIDED_LESSON ? guideSlugs().length : 0;
  const readGuides = totalGuides ? (entry.guides || []).length : 0;

  const parts = [];
  if (totalVideos) parts.push(Math.min(1, watched / totalVideos));
  if (deckPages) parts.push(Math.min(1, seen / deckPages));
  if (totalGuides) parts.push(Math.min(1, readGuides / totalGuides));
  parts.push(entry.read ? 1 : 0);
  const pct = Math.round((parts.reduce((a, b) => a + b, 0) / Math.max(parts.length, 1)) * 100);

  return {
    videos: watched,
    videosTotal: totalVideos,
    slides: seen,
    slidesTotal: deckPages,
    guides: readGuides,
    guidesTotal: totalGuides,
    read: !!entry.read,
    done: !!entry.done || pct >= 100,
    percent: entry.done ? 100 : pct,
  };
}

/* ------------------------------------------------------------ setup guides */

/** The lesson whose curriculum is the installation guides rather than a lecture. */
export const GUIDED_LESSON = 'install';

/** Lesson 1's guides are its whole curriculum, so they are progress too. */
export function guideSlugs() {
  return ((state.course && state.course.guides) || []).map((g) => g.slug);
}

export function isGuideRead(slug) {
  const lesson = (state.progress.lessons || {})[GUIDED_LESSON] || {};
  return (lesson.guides || []).includes(slug);
}

export function markGuideRead(slug) {
  if (isGuideRead(slug)) return Promise.resolve(null);
  const done = guideSlugs().every((s) => s === slug || isGuideRead(s));
  // reading the last guide also marks the lesson itself as read
  return patchProgress({
    lesson: { slug: GUIDED_LESSON, guides: [slug], ...(done ? { read: true } : {}) },
  });
}

export function courseProgress() {
  const lessons = (state.course && state.course.lessons) || [];
  if (!lessons.length) return { percent: 0, done: 0, total: 0, videos: 0, videosTotal: 0 };
  let sum = 0;
  let done = 0;
  let videos = 0;
  let videosTotal = 0;
  for (const l of lessons) {
    const p = lessonProgress(l.slug);
    sum += p.percent;
    if (p.done) done += 1;
    videos += p.videos;
    videosTotal += p.videosTotal;
  }
  return {
    percent: Math.round(sum / lessons.length),
    done,
    total: lessons.length,
    videos,
    videosTotal,
  };
}

export function isVideoWatched(lessonSlug, videoId) {
  const entry = state.progress.lessons[lessonSlug];
  return !!(entry && (entry.videos || []).includes(videoId));
}

export function isSlideSeen(lessonSlug, page) {
  const entry = state.progress.lessons[lessonSlug];
  return !!(entry && (entry.slides || []).includes(page));
}

export function bookmarks() { return state.progress.bookmarks || []; }

export function noteFor(chapter) { return state.progress.notes[chapter] || ''; }

export function exerciseState(id) { return state.progress.exercises[id] || null; }

/* ------------------------------------------------------------------- actions */

export function markVideoWatched(lessonSlug, videoId) {
  if (isVideoWatched(lessonSlug, videoId)) return Promise.resolve();
  return patchProgress({ lesson: { slug: lessonSlug, videos: [videoId] } });
}

export function markSlideSeen(lessonSlug, page) {
  if (isSlideSeen(lessonSlug, page)) return Promise.resolve();
  return patchProgress({ lesson: { slug: lessonSlug, slides: [page] } });
}

export function setLessonRead(lessonSlug, read = true) {
  return patchProgress({ lesson: { slug: lessonSlug, read } });
}

export function setLessonDone(lessonSlug, done = true) {
  return patchProgress({ lesson: { slug: lessonSlug, done } });
}

export function toggleBookmark(chapter, anchor, title) {
  return patchProgress({ bookmark: { chapter, anchor, title } });
}

export function saveNote(chapter, text) {
  return patchProgress({ note: { chapter, text } });
}

export function saveExercise(id, { passed, code }) {
  return patchProgress({ exercise: { id, passed, code } });
}

export function resetProgress() {
  return patchProgress({ reset: true });
}

/** Next / previous lesson in curriculum order. */
export function neighbours(slug) {
  const list = (state.course && state.course.lessons) || [];
  const i = list.findIndex((l) => l.slug === slug);
  return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}

/** The chapter a lesson reads from. */
export function chapterForLesson(lesson) {
  const slug = lesson && lesson.chapter;
  return slug ? idx.chapterBySlug.get(slug) : null;
}
