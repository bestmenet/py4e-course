import { sitePath, routePath, siteHTML } from './runtime.js';
import { t, currentLanguage } from './i18n.js';
export { t, currentLanguage, setLanguage } from './i18n.js';

/* core.js — DOM helpers, router, theme, toast, modal, misc formatting.
   No dependencies. Everything else in the app builds on this. */

/* ------------------------------------------------------------ dom helpers */

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = siteHTML(value);
      else if (key === 'text') node.textContent = t(value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, ['href', 'src', 'poster'].includes(key) && typeof value === 'string' ? sitePath(value) : (value === true ? '' : (typeof value === 'string' && ['placeholder', 'aria-label', 'title', 'data-tip'].includes(key) ? t(value) : value)));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(t(String(child))));
  }
  return node;
}

export const $ = (sel, scope) => (scope || document).querySelector(sel);
export const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

export function frag(...children) {
  const f = document.createDocumentFragment();
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    f.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return f;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function debounce(fn, wait = 180) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let pending = null;
  return function throttled(...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    } else if (!pending) {
      pending = setTimeout(() => {
        pending = null;
        last = Date.now();
        fn.apply(this, args);
      }, wait - (now - last));
    }
  };
}

/* --------------------------------------------------------------- formatting */

export function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  return n.toLocaleString('en-US');
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (currentLanguage() === 'zh') {
    if (h) return `${h}小时${m ? `${m}分` : ''}`;
    if (m) return `${m}分钟`;
    return `${s}秒`;
  }
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(currentLanguage() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (currentLanguage() === 'zh') {
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
    return fmtDate(ts);
  }
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(ts);
}

export function titleCase(text) {
  return String(text || '').replace(/(^|\s|-)([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-');
}

/* ------------------------------------------------------------------ storage */

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`py4e:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`py4e:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
    return value;
  },
  del(key) {
    try { localStorage.removeItem(`py4e:${key}`); } catch { /* ignore */ }
  },
};

/* ------------------------------------------------------------------- theme */

const THEME_KEY = 'theme';

export function currentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(mode) {
  if (mode === 'system') {
    document.documentElement.removeAttribute('data-theme');
    store.del(THEME_KEY);
  } else {
    document.documentElement.setAttribute('data-theme', mode);
    store.set(THEME_KEY, mode);
  }
  document.dispatchEvent(new CustomEvent('themechange', { detail: currentTheme() }));
}

export function initTheme() {
  // ?theme=dark|light pins the palette for one page load, which is handy for
  // sharing a link or capturing a screenshot in a known theme
  const forced = new URLSearchParams(window.location.search).get('theme');
  if (forced === 'dark' || forced === 'light') {
    document.documentElement.setAttribute('data-theme', forced);
    return;
  }
  const saved = store.get(THEME_KEY);
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.setAttribute('data-theme', saved);
  }
}

/* ------------------------------------------------------------------- toast */

function toastHost() {
  let host = $('.toasts');
  if (!host) {
    host = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

export function toast(message, kind = '', ms = 2600) {
  const node = el('div', { class: 'toast', dataset: kind ? { kind } : {} }, message);
  toastHost().append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 260);
  }, ms);
  return node;
}

/* ------------------------------------------------------------------- modal */

export function openModal({ title, body, footer, wide = false, onClose }) {
  const backdrop = el('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' });
  const dialog = el('div', { class: `modal${wide ? ' modal-wide' : ''}` });

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  if (title) {
    dialog.append(el('div', { class: 'modal-head' },
      typeof title === 'string' ? el('h2', { style: { fontSize: 'var(--fs-xl)' } }, title) : title,
      el('button', { class: 'btn btn-quiet btn-icon', 'aria-label': 'Close', onclick: close }, icon('x'))));
  }
  dialog.append(el('div', { class: 'modal-body' }, body));
  if (footer) dialog.append(el('div', { class: 'modal-foot' }, footer));

  backdrop.append(dialog);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  const focusable = dialog.querySelector('input, textarea, button, [href]');
  if (focusable) setTimeout(() => focusable.focus(), 30);
  return { close, dialog, body: dialog.querySelector('.modal-body') };
}

/* ------------------------------------------------------------------- icons */

const ICONS = {
  play: 'M6 4.5v15l13-7.5-13-7.5z',
  pause: 'M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z',
  check: 'M4.5 12.5l5 5 10-11',
  clock: 'M12 7v5l3.5 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  book: 'M4 4.5h6.5a2 2 0 0 1 2 2V20a2 2 0 0 0-2-1.6H4zM20 4.5h-6.5a2 2 0 0 0-2 2V20a2 2 0 0 1 2-1.6H20z',
  slides: 'M3 4.5h18v11H3zM12 15.5V20M8 20h8',
  video: 'M3 6.5h12v11H3zM15 10l6-3.5v11L15 14z',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  search: 'M10.5 3a7.5 7.5 0 1 0 4.6 13.4L20 21.3l1.3-1.3-4.9-4.9A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z',
  x: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronDown: 'M5 9l7 7 7-7',
  arrowRight: 'M4 12h15M13 6l6 6-6 6',
  arrowLeft: 'M20 12H5M11 18l-6-6 6-6',
  arrowUpRight: 'M7 17L17 7M9 7h8v8',
  download: 'M12 4v11M7.5 11L12 15.5 16.5 11M4.5 19.5h15',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5.5A1.5 1.5 0 0 1 16.5 21h-11A1.5 1.5 0 0 1 4 19.5v-11A1.5 1.5 0 0 1 5.5 7H11',
  check_circle: 'M9 12.5l2.5 2.5L16 9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  bookmark: 'M6.5 4h11a1 1 0 0 1 1 1v15.5L12 17l-6.5 3.5V5a1 1 0 0 1 1-1z',
  note: 'M5 4.5h9.5L19 9v10.5H5zM14 4.5V9h5',
  sun2: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  sparkle: 'M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  db: 'M12 3c4.4 0 8 1.1 8 2.5v13c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5v-13C4 4.1 7.6 3 12 3zM4 5.5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c2.5 2.4 3.8 5.5 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z',
  flask: 'M10 3v6.5L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.5V3M8.5 3h7',
  terminal: 'M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M13 15h4',
  reset: 'M4 10a8 8 0 1 1 2.4 5.7M4 4v6h6',
  copy: 'M8.5 8.5V5A1 1 0 0 1 9.5 4h9A1 1 0 0 1 19.5 5v9a1 1 0 0 1-1 1H15M4.5 9.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z',
  save: 'M5 4h11l3 3v13H5zM8.5 4v5h6V4M8 20v-6h8v6',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  filter: 'M3 5h18l-7 8.5V20l-4-2v-4.5z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5.5M12 7.6h.01',
  warn: 'M12 3.5l9 16H3zM12 10v4M12 17h.01',
  print: 'M7 8V3h10v5M7 18H5a1 1 0 0 1-1-1v-7h16v7a1 1 0 0 1-1 1h-2M7 14h10v7H7z',
  home: 'M4 10.5L12 4l8 6.5V20H4z',
  route: 'M6 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 15V9.5A3.5 3.5 0 0 1 9.5 6H14',
  bookOpen: 'M12 6.5C10.5 5 8.5 4.5 4.5 4.5v13c4 0 6 .5 7.5 2 1.5-1.5 3.5-2 7.5-2v-13c-4 0-6 .5-7.5 2zM12 6.5V19.5',
  flame: 'M12 3s5 4.2 5 9a5 5 0 0 1-10 0c0-1.7.8-3.2 1.6-4.2C9.4 6.4 12 5.6 12 3z',
  eye: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12zM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z',
  eyeOff: 'M4 4l16 16M9.6 9.7A2.6 2.6 0 0 0 12 14.6c.7 0 1.4-.3 1.9-.7M6.3 6.6C4.2 8.2 2.5 12 2.5 12S6 17.5 12 17.5c1.5 0 2.8-.4 4-1M17.6 15c1.6-1.3 2.6-3 2.6-3S18 6.5 12 6.5c-.6 0-1.2.1-1.7.2',
  menu: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  zap: 'M13.5 3L5 13.5h6L10.5 21 19 10.5h-6z',
  python: 'M12 3c-3.5 0-3.3 1.5-3.3 1.5v2.2h3.4v.7H6.6S4 7 4 10.6s2.3 3.5 2.3 3.5h1.4v-1.7s-.1-2.3 2.3-2.3h3.4s2.2 0 2.2-2.1V5.2S16 3 12 3zM9.9 4.3a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zM12 21c3.5 0 3.3-1.5 3.3-1.5v-2.2h-3.4v-.7h5.5S20 17 20 13.4s-2.3-3.5-2.3-3.5h-1.4v1.7s.1 2.3-2.3 2.3h-3.4s-2.2 0-2.2 2.1v2.8S8 21 12 21zm2.1-1.3a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z',
};

export function icon(name, size = 16, extraClass = '') {
  const path = ICONS[name] || ICONS.circle;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (extraClass) svg.setAttribute('class', extraClass);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

/* ------------------------------------------------------------------- router */

const routes = [];
let notFound = null;
let currentPath = null;
let onNavigate = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern
    .replace(/\/$/, '')
    .replace(/[.+*?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (m, key) => { keys.push(key); return '([^/]+)'; })
    .replace(/\\\/$/, '') + '/?$');
  routes.push({ regex, keys, handler, pattern });
}

export function setNotFound(handler) { notFound = handler; }
export function onRouteChange(fn) { onNavigate = fn; }

export function navigate(path, { replace = false, keepScroll = false } = {}) {
  const target = path.startsWith('/') ? path : `/${path}`;
  if (replace) history.replaceState({}, '', sitePath(target));
  else history.pushState({}, '', sitePath(target));
  resolve({ keepScroll });
}

export function currentRoute() { return currentPath; }

function resolve({ keepScroll = false } = {}) {
  const url = new URL(location.href);
  const path = routePath(url.pathname).replace(/\/+$/, '') || '/';
  const previous = currentPath;
  currentPath = path;

  let match = null;
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m) { match = { r, m }; break; }
  }

  const scrollKey = `scroll:${path}`;
  if (!keepScroll && previous) store.set(`scroll:${previous}`, window.scrollY);

  if (onNavigate) onNavigate(path, previous);

  if (match) {
    const params = {};
    match.r.keys.forEach((key, i) => { params[key] = decodeURIComponent(match.m[i + 1]); });
    match.r.handler(params, url.searchParams);
  } else if (notFound) {
    notFound(path);
  }

  const restored = !keepScroll && store.get(scrollKey, 0);
  requestAnimationFrame(() => window.scrollTo(0, restored || 0));
}

export function startRouter() {
  window.addEventListener('popstate', () => resolve({ keepScroll: true }));
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.external) return;
    const rawHref = a.getAttribute('href');
    const href = rawHref?.startsWith('/') ? routePath(rawHref) : rawHref;
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
    if (href.startsWith('/static/') || href.startsWith('/assets/')) return;
    e.preventDefault();
    if (href === currentPath + location.search) return;
    navigate(href);
  });
  resolve({ keepScroll: true });
}

/* -------------------------------------------------------------- misc helpers */

export function youtubeThumb(id, quality = 'mq') {
  return `https://i.ytimg.com/vi/${id}/${quality}default.jpg`;
}

/** True when the browser believes it is offline (so we can skip the network). */
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function youtubeEmbed(id, { autoplay = false, start = 0 } = {}) {
  const params = new URLSearchParams({
    rel: '0', modestbranding: '1', playsinline: '1',
  });
  if (autoplay) params.set('autoplay', '1');
  if (start) params.set('start', String(Math.floor(start)));
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const ta = el('textarea', {
    style: { position: 'fixed', left: '-9999px', top: '0' },
  });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return Promise.resolve();
}

/** Read the reading-progress fraction of a scrollable document. */
export function readFraction() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  return max <= 0 ? 1 : Math.min(1, Math.max(0, doc.scrollTop / max));
}

export function onIdle(fn) {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1200 });
  else setTimeout(fn, 1);
}

/**
 * Run `fn` once, at the start of the next route change.
 *
 * A view that subscribes to the store has to stop listening when the router
 * moves on, or it will keep repainting pieces of a page that is no longer
 * mounted.  The router announces every transition with `viewchange`, so this
 * is the hook to hang that cleanup on.
 */
export function onLeaveView(fn) {
  const handler = () => {
    document.removeEventListener('viewchange', handler);
    fn();
  };
  document.addEventListener('viewchange', handler);
  return () => document.removeEventListener('viewchange', handler);
}

/** Progress bar pinned under the top bar. */
export function mountReadBar() {
  const bar = el('div', { class: 'readbar', 'aria-hidden': 'true' }, el('span'));
  document.body.append(bar);
  const fill = bar.firstChild;
  const update = throttle(() => {
    fill.style.width = `${(readFraction() * 100).toFixed(1)}%`;
  }, 60);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  document.addEventListener('viewchange', update);
  update();
  return bar;
}
