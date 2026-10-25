/* Static GitHub Pages adapter. Content is fetched from the generated JSON
   bundle; execution is delegated to the browser runner. */

import { sitePath } from './runtime.js';
import { runPython } from './browser-runner.js';
import { progress } from './static-progress.js';
import { search as searchIndex, suggest as suggestIndex } from './static-search.js';

async function getJson(path) {
  const response = await fetch(sitePath(path));
  if (!response.ok) {
    const error = new Error(`Unable to load ${path} (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

const memo = new Map();
function cached(key, loader) {
  if (!memo.has(key)) {
    memo.set(key, loader().catch((error) => {
      memo.delete(key);
      throw error;
    }));
  }
  return memo.get(key);
}

function safeName(name) {
  const value = String(name || '');
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error('Invalid sample code filename');
  }
  return value;
}

async function codeIndex() {
  return cached('code-index', () => getJson('/data/code-index.json'));
}

export const api = {
  health: async () => {
    const course = await api.course();
    return { ok: true, runner: true, runner_error: null, search: true,
      search_error: null, stats: course.stats || {} };
  },

  course: () => cached('course', () => getJson('/data/course.json')),
  chapter: (slug) => cached(`chapter:${slug}`, () => getJson(`/data/chapters/${encodeURIComponent(slug)}.json`)),
  deck: (slug) => cached(`deck:${slug}`, () => getJson(`/data/decks/${encodeURIComponent(slug)}.json`)),
  guide: (slug) => cached(`guide:${slug}`, () => getJson(`/data/guides/${encodeURIComponent(slug)}.json`)),

  search: async (query, { limit = 25, chapter = null, lessons = false } = {}) => {
    const docs = await cached('search-index', () => getJson('/data/search.json'));
    const ix = searchIndex(docs, query, { limit, chapter, lessons });
    return { query: String(query || ''), count: ix.results.length, ...ix };
  },
  suggest: async (query) => {
    const docs = await cached('search-index', () => getJson('/data/search.json'));
    return { suggestions: suggestIndex(docs, query, 8) };
  },

  codeList: () => codeIndex(),
  codeFile: (name) => {
    const safe = safeName(name);
    return cached(`code:${safe}`, async () => {
      const index = await codeIndex();
      const entry = (index.files || []).find((file) => file.name === safe);
      if (!entry) {
        const error = new Error(`No such sample code file: ${safe}`);
        error.status = 404;
        throw error;
      }
      if (entry.bytes > 4 * 1024 * 1024) {
        const error = new Error(`Sample code file is too large to display inline: ${safe}`);
        error.status = 413;
        throw error;
      }
      const response = await fetch(sitePath(`/static/code/${encodeURIComponent(safe)}`));
      if (!response.ok) {
        const error = new Error(`Unable to load sample code ${safe} (HTTP ${response.status})`);
        error.status = response.status;
        throw error;
      }
      return { name: safe, kind: entry.kind, bytes: entry.bytes,
        text: await response.text(), runnable: safe.endsWith('.py') };
    });
  },

  sandbox: async () => {
    const index = await codeIndex();
    return { python: 'WebAssembly Python', sandbox_dir: 'browser sandbox',
      file_count: index.count ?? (index.files || []).length,
      notice: 'Runs locally in your browser. Files and network access are limited by the browser runtime.' };
  },
  run: (payload) => runPython(payload),
  runFile: async (name, stdin = '') => {
    const code = await api.codeFile(name);
    return runPython({ code: code.text, stdin });
  },

  progress: () => progress.load(),
  saveProgress: (patch) => progress.update(patch),
};

/** Fetch a chapter body, falling back to the bundled copy inside course.json. */
export async function chapterWithFallback(slug) {
  try {
    return await api.chapter(slug);
  } catch {
    const course = await api.course();
    const summary = (course.chapters || []).find((chapter) => chapter.slug === slug);
    if (!summary || !summary.html) throw new Error(`chapter ${slug} unavailable`);
    return summary;
  }
}
