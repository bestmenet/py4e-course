/* Exercise the playground's run path against the live server.

   Usage: node _scrape/playtest.mjs [base-url] */
import { JSDOM } from 'jsdom';
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const dom = new JSDOM('<!doctype html><body><div id="boot"></div></body>', { url: BASE + '/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.localStorage = window.localStorage;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.getComputedStyle = () => ({ lineHeight: '21px' });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'performance', { value: { now: () => Date.now(), markResourceTiming() {} }, configurable: true });
Object.defineProperty(window, 'performance', { value: globalThis.performance, configurable: true });
window.matchMedia = () => ({ matches: false, addEventListener() {} });
Element.prototype.scrollIntoView = function () {};

const rf = globalThis.fetch;
globalThis.fetch = (u, o) => rf(u.startsWith('http') ? u : BASE + u, o);
window.fetch = globalThis.fetch;

const { state, loadCourse, loadProgress } = await import('../web/assets/js/data.js');
const { shell } = await import('../web/assets/js/components.js');
const pg = await import('../web/assets/js/views/playground.js');
await loadCourse(); await loadProgress();

const { view } = shell();
document.body.append(view);
await pg.renderPlayground(view, {}, new URLSearchParams());
await new Promise((r) => setTimeout(r, 600));

const editor = view.querySelector('.editor');
const runBtn = [...view.querySelectorAll('button')].find((b) => /^Run/.test(b.textContent.trim()));
console.log('editor present:', !!editor, 'value:', JSON.stringify(editor.value));
runBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 1800));
console.log('console output:', JSON.stringify(view.querySelector('.console').textContent));

// now a program that reads a course data file
editor.value = "print(sum(1 for l in open('romeo.txt')))";
editor.dispatchEvent(new window.Event('input', { bubbles: true }));
runBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 1800));
console.log('second run:', JSON.stringify(view.querySelector('.console').textContent));

// stdin path
editor.value = "name = input('Name: ')\nprint('hi', name)";
view.querySelector('.console').textContent = '';
const stdin = view.querySelector('textarea[aria-label="Standard input"]');
stdin.value = 'Ada';
runBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 1800));
console.log('stdin run:', JSON.stringify(view.querySelector('.console').textContent));

// repl mode
const replBtn = [...view.querySelectorAll('.segmented button')].find((b) => /Interactive/.test(b.textContent));
replBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
editor.value = ">>> x = 21\n>>> x * 2";
runBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 1800));
console.log('repl run:', JSON.stringify(view.querySelector('.console').textContent));

// library: run a real sample program
const lib = await import('../web/assets/js/views/library.js');
await lib.renderLibrary(view, {}, new URLSearchParams('f=words.py'));
await new Promise((r) => setTimeout(r, 900));
const runFileBtn = [...view.querySelectorAll('button')].find((b) => /Run this program/.test(b.textContent));
console.log('run-file button present:', !!runFileBtn);
if (runFileBtn) {
  runFileBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 2200));
  console.log('file run output:', JSON.stringify(view.querySelector('.runner-out').textContent));
}
