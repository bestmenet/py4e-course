/* Resolve resources and navigation under a GitHub Pages project path. */
export const BASE_PATH = new URL('../../', import.meta.url).pathname;

export function sitePath(path = '/') {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (BASE_PATH !== '/' && path.startsWith(BASE_PATH)) return path;
  return BASE_PATH + path.slice(1);
}

export function routePath(path = location.pathname) {
  return path.startsWith(BASE_PATH) ? '/' + path.slice(BASE_PATH.length) : path;
}

export function siteHTML(html) {
  return String(html).replace(/\b(href|src|poster)=(['"])(\/(?!\/)[^'"]*)\2/g,
    (_, attr, quote, path) => `${attr}=${quote}${sitePath(path)}${quote}`);
}
