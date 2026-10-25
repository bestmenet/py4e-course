/* Persistent single-learner progress for static hosting. */

import { sitePath } from './runtime.js';

const EMPTY = () => ({
  lessons: {}, exercises: {}, bookmarks: [], notes: {}, streak: { days: [], last: null },
});

function storageKey() {
  let base = '/';
  try {
    const url = new URL(sitePath('/'), globalThis.location?.href || 'https://pages.invalid/');
    base = url.pathname.replace(/\/+$/, '') || '/';
  } catch {
    // The default namespace remains usable in non-browser harnesses.
  }
  return `py4e:pages-progress:${base}`;
}

const key = storageKey();

function storageError(action, cause) {
  const error = new Error(`Could not ${action} course progress in this browser. Check that site storage is enabled and has available space.`);
  error.cause = cause;
  return error;
}

function normalize(data) {
  const empty = EMPTY();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
  for (const field of Object.keys(empty)) {
    const expected = Array.isArray(empty[field]) ? Array : typeof empty[field];
    if (!data[field] || (expected === Array ? !Array.isArray(data[field]) : typeof data[field] !== expected)) {
      data[field] = empty[field];
    }
  }
  if (!Array.isArray(data.streak.days)) data.streak = empty.streak;
  if (!Object.prototype.hasOwnProperty.call(data.streak, 'last')) data.streak.last = null;
  return data;
}

function read() {
  let raw;
  try {
    raw = globalThis.localStorage.getItem(key);
  } catch (error) {
    throw storageError('read', error);
  }
  if (raw == null) return EMPTY();
  try {
    return normalize(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) return EMPTY();
    throw error;
  }
}

function write(data) {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    throw storageError('save', error);
  }
  return data;
}

function touchStreak(data) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const streak = data.streak || (data.streak = { days: [], last: null });
  const days = Array.isArray(streak.days) ? streak.days : (streak.days = []);
  if (!days.includes(today)) {
    days.push(today);
    days.sort();
    if (days.length > 400) days.splice(0, days.length - 400);
  }
  streak.last = today;
}

function addUnique(target, values, type) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (typeof value === type && !target.includes(value)) target.push(value);
  }
}

function apply(data, patch) {
  if (!patch || typeof patch !== 'object') return data;
  if (patch.reset) return EMPTY();

  const lesson = patch.lesson;
  if (lesson && typeof lesson === 'object' && typeof lesson.slug === 'string') {
    const entry = data.lessons[lesson.slug] || (data.lessons[lesson.slug] = {
      videos: [], read: false, slides: [], guides: [], done: false,
    });
    if (!Array.isArray(entry.videos)) entry.videos = [];
    if (!Array.isArray(entry.slides)) entry.slides = [];
    if (!Array.isArray(entry.guides)) entry.guides = [];
    addUnique(entry.videos, lesson.videos, 'string');
    addUnique(entry.slides, lesson.slides, 'number');
    addUnique(entry.guides, lesson.guides, 'string');
    for (const flag of ['read', 'done']) if (flag in lesson) entry[flag] = !!lesson[flag];
    entry.updated = Date.now() / 1000;
    touchStreak(data);
  }

  const exercise = patch.exercise;
  if (exercise && typeof exercise === 'object' && typeof exercise.id === 'string') {
    const entry = data.exercises[exercise.id] || (data.exercises[exercise.id] = {});
    if ('passed' in exercise) entry.passed = !!exercise.passed;
    if (typeof exercise.code === 'string') entry.code = exercise.code.slice(0, 20000);
    entry.updated = Date.now() / 1000;
    touchStreak(data);
  }

  const note = patch.note;
  if (note && typeof note === 'object' && typeof note.chapter === 'string') {
    data.notes[note.chapter] = String(note.text || '').slice(0, 20000);
    touchStreak(data);
  }

  const bookmark = patch.bookmark;
  if (bookmark && typeof bookmark === 'object' && typeof bookmark.chapter === 'string') {
    const anchor = String(bookmark.anchor || '');
    const found = data.bookmarks.some((item) => item.chapter === bookmark.chapter && item.anchor === anchor);
    if (found) {
      data.bookmarks = data.bookmarks.filter((item) => !(item.chapter === bookmark.chapter && item.anchor === anchor));
    } else {
      data.bookmarks.unshift({ chapter: bookmark.chapter, anchor,
        title: String(bookmark.title || '').slice(0, 200), at: Date.now() / 1000 });
      data.bookmarks.splice(200);
    }
    touchStreak(data);
  }
  return data;
}

export const progress = {
  async load() {
    return read();
  },
  async update(patch) {
    const current = read();
    return write(apply(current, patch));
  },
};
