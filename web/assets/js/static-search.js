/* Browser implementation of server/search.py over the bundled compact index. */

const STOPWORDS = new Set(`a about above after again against all am an and any are aren as at be because been before being
below between both but by can cannot could couldn did didn do does doesn doing don down during
each few for from further had hadn has hasn have haven having he her here hers herself him
himself his how i if in into is isn it its itself just let me more most mustn my myself no nor
not now of off on once only or other ought our ours ourselves out over own same shan she should
shouldn so some such than that the their theirs them themselves then there these they this those
through to too under until up very was wasn we were weren what when where which while who whom
why will with won would wouldn you your yours yourself yourselves`.split(/\s+/));
const splitPattern = /[^0-9a-zA-Z_.]+/;
const tokenPattern = /^[a-z0-9][a-z0-9_.]*$/;
const K1 = 1.2;
const B = 0.75;

function stem(token) {
  if (token.length < 5 || !/^[a-z]+$/.test(token)) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'edly', 'ed', 'es', 's']) {
    if (!token.endsWith(suffix) || token.length - suffix.length < 4) continue;
    const base = token.slice(0, -suffix.length);
    if (suffix === 's' && /(?:s|u|i)$/.test(base)) continue;
    if (suffix === 'es' && !/(?:s|x|z|ch|sh)$/.test(base)) continue;
    return base;
  }
  return token;
}

function tokenize(value) {
  const out = [];
  for (const raw of String(value || '').toLowerCase().split(splitPattern)) {
    if (!raw || !tokenPattern.test(raw)) continue;
    if (!STOPWORDS.has(raw)) {
      out.push(raw);
      const stemmed = stem(raw);
      if (stemmed !== raw) out.push(stemmed);
    }
    if (raw.length > 3 && /[_.]/.test(raw)) {
      for (const part of raw.split(/[_.]/)) {
        if (part.length > 1 && !STOPWORDS.has(part)) {
          out.push(part);
          const stemmed = stem(part);
          if (stemmed !== part) out.push(stemmed);
        }
      }
    }
  }
  return out;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
  })[char]);
}

function mark(value, terms) {
  const escaped = escapeHtml(value);
  const alternatives = [...new Set(terms)].sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!alternatives.length) return escaped;
  return escaped.replace(new RegExp(`(${alternatives.join('|')})`, 'gi'), '<mark>$1</mark>');
}

function makeIndex(docs) {
  const entries = (Array.isArray(docs) ? docs : []).filter((doc) => doc && typeof doc === 'object')
    .map((doc) => {
      const title = String(doc.t || '');
      const body = String(doc.x || '');
      return { doc, title, body, lowTitle: title.toLowerCase(), lowBody: body.toLowerCase(),
        titleTokens: tokenize(title), bodyTokens: tokenize(body) };
    });
  const n = entries.length;
  const avgLen = n ? entries.reduce((sum, item) => sum + Math.max(item.bodyTokens.length, 1), 0) / n : 1;
  const bodyPost = new Map();
  const titlePost = new Map();
  const freq = new Map();
  entries.forEach((entry, i) => {
    const add = (map, tokens, countFrequency) => {
      for (const term of tokens) {
        if (!map.has(term)) map.set(term, new Map());
        const posting = map.get(term);
        posting.set(i, (posting.get(i) || 0) + 1);
        if (countFrequency) freq.set(term, (freq.get(term) || 0) + 1);
      }
    };
    add(titlePost, entry.titleTokens, false);
    add(bodyPost, entry.bodyTokens, true);
  });
  return { entries, n, avgLen, bodyPost, titlePost, freq };
}

function bm25(index, term, doc, posting, length) {
  const docs = posting.get(term);
  const tf = docs && docs.get(doc);
  if (!tf) return 0;
  const df = docs.size;
  const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
  return idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * length / index.avgLen));
}

function score(index, i, terms, phrase) {
  const entry = index.entries[i];
  const length = Math.max(entry.bodyTokens.length, 1);
  let value = 0;
  for (const term of terms) {
    value += bm25(index, term, i, index.bodyPost, length);
    value += 3 * bm25(index, term, i, index.titlePost, Math.max(entry.titleTokens.length, 1));
  }
  if (!value) return 0;
  if (phrase && entry.lowTitle.includes(phrase)) value += 12 * Math.max(1, terms.length);
  else if (phrase && entry.lowBody.includes(phrase)) value += 2.5 * Math.max(1, terms.length);
  if (entry.titleTokens.length) {
    const q = new Set(terms.flatMap((term) => [term, stem(term)]));
    let matched = 0;
    for (const term of entry.titleTokens) if (q.has(term)) matched += 1;
    value *= 0.85 + 0.9 * matched / entry.titleTokens.length;
  }
  value *= 1 + 0.15 * (1 - Math.min(length / index.avgLen, 1));
  const found = terms.reduce((count, term) => count +
    (index.bodyPost.get(term)?.has(i) || index.titlePost.get(term)?.has(i) ? 1 : 0), 0);
  if (found < terms.length) value *= 0.35 ** (terms.length - found);
  else if (terms.length > 1) value *= 1.25;
  return value;
}

function snippet(body, terms, phrase, width = 240) {
  if (!body) return '';
  const low = body.toLowerCase();
  const positions = [];
  for (const term of terms) {
    let start = 0;
    while (true) {
      const at = low.indexOf(term, start);
      if (at < 0) break;
      positions.push(at);
      start = at + term.length;
      if (positions.length > 200) break;
    }
  }
  if (phrase && phrase.length > 3) {
    const at = low.indexOf(phrase);
    if (at >= 0) positions.push(at, at, at);
  }
  if (!positions.length) return escapeHtml(body.slice(0, width).trim()) + (body.length > width ? '…' : '');
  positions.sort((a, b) => a - b);
  let bestStart = positions[0];
  let bestCount = 0;
  let left = 0;
  for (let right = 0; right < positions.length; right += 1) {
    while (positions[right] - positions[left] > width) left += 1;
    if (right - left + 1 > bestCount) {
      bestCount = right - left + 1;
      bestStart = positions[left];
    }
  }
  let start = Math.max(0, bestStart - Math.floor(width / 4));
  let end = Math.min(body.length, start + width);
  while (start > 0 && !/[ \n\t]/.test(body[start - 1])) start -= 1;
  while (end < body.length && !/[ \n\t]/.test(body[end])) end += 1;
  let result = mark(body.slice(start, end).trim(), terms);
  if (start > 0) result = `…${result}`;
  if (end < body.length) result += '…';
  return result;
}

export function search(docs, query, { limit = 25, chapter = null, lessons = false } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { results: [], suggestions: [] };
  const index = makeIndex(docs);
  const terms = [...new Set(tokenize(q))];
  if (!terms.length) return { results: [], suggestions: suggestFromIndex(index, q, 6) };
  const candidates = new Set();
  for (const term of terms) {
    for (const i of index.bodyPost.get(term)?.keys() || []) candidates.add(i);
    for (const i of index.titlePost.get(term)?.keys() || []) candidates.add(i);
  }
  const chapters = Array.isArray(chapter) ? chapter : (chapter ? [chapter] : []);
  const phrase = q.toLowerCase().split(/\s+/).join(' ');
  const ranked = [];
  for (const i of candidates) {
    const doc = index.entries[i].doc;
    if (lessons ? !doc.lesson : chapters.length && (doc.lesson || !chapters.includes(doc.c))) continue;
    const value = score(index, i, terms, phrase);
    if (value > 0) ranked.push({ i, value });
  }
  ranked.sort((a, b) => b.value - a.value ||
    index.entries[a.i].bodyTokens.length - index.entries[b.i].bodyTokens.length);
  const parsedLimit = Number.parseInt(limit, 10);
  const max = Math.max(0, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 25, 100));
  const results = ranked.slice(0, max).map(({ i, value }) => {
    const { doc, title, body } = index.entries[i];
    return { title, title_html: mark(title, terms), chapter: doc.c ?? null,
      anchor: String(doc.a || ''), is_lesson: !!doc.lesson,
      guide: doc.g || doc.guide || null, score: Math.round(value * 1000) / 1000,
      snippet: snippet(body, terms, phrase) };
  });
  return { results, suggestions: suggestFromIndex(index, q, 6) };
}

function suggestFromIndex(index, prefix, limit) {
  const start = String(prefix || '').trim().toLowerCase();
  if (start.length < 2) return [];
  return [...index.freq].filter(([term]) => term.startsWith(start))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit).map(([term]) => term);
}

export function suggest(docs, prefix, limit = 8) {
  return suggestFromIndex(makeIndex(docs), prefix, limit);
}
