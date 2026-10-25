/* Browser regression checks for the exported course. Serve dist before running. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const base = (process.env.PY4E_TEST_URL || 'http://127.0.0.1:8000/py4e-course/').replace(/\/?$/, '/');
const course = JSON.parse(fs.readFileSync(new URL('../data/course.json', import.meta.url)));
const routes = ['', 'syllabus', 'setup', 'read', 'book', 'videos', 'slides', 'library', 'playground', 'search', 'progress'];
for (const [prefix, key] of [['lesson', 'lessons'], ['read', 'chapters'], ['slides', 'decks'], ['setup', 'guides']]) {
  routes.push(...course[key].map(entry => `${prefix}/${entry.slug}`));
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'],
});
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// Test bundled content independently of third-party video availability.
await context.route('https://**', route => route.abort());
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && message.location().url.startsWith(base)) errors.push(message.text());
});
page.on('response', response => {
  if (response.url().startsWith(base) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
});
async function visit(route) {
  await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const main = document.querySelector('#main-content');
    return main?.textContent.trim().length > 50 && !main.querySelector('.skeleton');
  });
  assert.equal(await page.locator('main').count(), 1, `single main: ${route}`);
  assert.equal(await page.locator('#main-content').count(), 1, `unique main id: ${route}`);
  assert.ok(await page.title(), `title: ${route}`);
  assert.ok(await page.locator('main h1').count(), `heading: ${route}`);
  assert.doesNotMatch(await page.locator('main').innerText(), /Something went wrong|The course could not load|No such (lesson|chapter|guide|deck)/);
  assert.deepEqual(await page.locator('main img').evaluateAll(images => images
    .filter(img => img.src.startsWith(location.origin) && img.complete && !img.naturalWidth)
    .map(img => img.src)), [], `local images: ${route}`);
}
try {
  await page.goto(base);
  for (const language of process.argv.includes('--interactions-only') ? [] : ['en', 'zh']) {
    await page.evaluate(lang => localStorage.setItem('py4e:language', lang), language);
    for (const route of routes) await visit(route);
    assert.equal(await page.locator('html').getAttribute('lang'), language === 'zh' ? 'zh-CN' : 'en');
    console.log(`PASS ${routes.length} routes (${language})`);
  }

  await visit('');
  assert.match(await page.locator('main h1').textContent(), /[\u4e00-\u9fff]/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/py4e-zh-home.png' });
  await page.locator('.language-button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('main h1'));
  assert.match(await page.locator('main h1').textContent(), /Learn to program/);
  await page.locator('.language-button').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && document.querySelector('main h1'));
  await page.reload();
  await page.locator('main h1').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('py4e:language')), 'zh');
  assert.equal(await page.locator('.skip-link').count(), 1);
  console.log('PASS language switch and persistence');

  // Three exercises in chapter 3 must have independent, reversible completion.
  await visit('lesson/logic?tab=practice');
  const cards = page.locator('article.card');
  assert.equal(await cards.count(), 3);
  const firstButton = cards.nth(0).locator('button').last();
  const firstStatus = cards.nth(0).locator('.badge').first();
  await firstButton.click();
  assert.equal(await firstStatus.textContent(), '已解决');
  await firstButton.click();
  assert.equal(await firstStatus.textContent(), '未解决');
  await cards.nth(1).locator('button').last().click();
  await page.reload();
  await cards.nth(2).waitFor();
  assert.equal(await cards.nth(0).locator('.badge').first().textContent(), '未解决');
  assert.equal(await cards.nth(1).locator('.badge').first().textContent(), '已解决');
  await cards.nth(0).locator('a[href$="/playground"]').click();
  await page.locator('.editor').waitFor();
  assert.equal(new URL(page.url()).search, '');
  assert.doesNotMatch((await page.locator('.toast').allTextContents()).join(' '), /Could not load|无法加载/);
  await page.locator('.editor').fill("print('中文测试')");
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.playground .btn-primary').disabled, null, { timeout: 100000 });
  assert.equal(await page.locator('.console').textContent(), '中文测试\n');
  assert.doesNotMatch(await page.locator('.playground .meta-row').textContent(), /\bnull\b/);
  assert.equal(await page.getByRole('button', { name: '运行', exact: true }).count(), 1);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/py4e-zh-playground.png' });
  console.log('PASS independent exercise state, playground link, Chinese execution');

  await visit('search?q=dictionary');
  await page.locator('.result').first().waitFor();
  assert.doesNotMatch(await page.locator('.filterbar').textContent(), /\bnull\b/);
  await page.locator('.result h3 a').first().click();
  await page.locator('.reader-main').waitFor();
  assert.match(new URL(page.url()).pathname, /\/(read|lesson|setup)\//);
  await visit('read/07-files');
  await page.locator('.note-pad').fill('笔记不应在刷新时丢失');
  await page.reload();
  await page.locator('.note-pad').waitFor();
  assert.equal(await page.locator('.note-pad').inputValue(), '笔记不应在刷新时丢失');
  await visit('slides/01-intro');
  const before = await page.locator('.stage img').getAttribute('src');
  await page.locator('.slide-bar button').nth(1).click();
  assert.notEqual(await page.locator('.stage img').getAttribute('src'), before);
  console.log('PASS search result navigation and slide paging');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['', 'syllabus', 'book', 'setup', 'playground', 'library', 'lesson/logic?tab=practice']) {
    await visit(route);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `mobile overflow: ${route}`);
  }
  await visit('');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.locator('.menu a[href$="/playground"]').click();
  await page.locator('.editor').waitFor();
  await page.waitForTimeout(500);
  const modeBox = await page.locator('[data-mode="script"]').boundingBox();
  assert.ok(modeBox.height < 50, 'mobile mode label remains on one line');
  const starterBox = await page.locator('.playground select').boundingBox();
  const panelBox = await page.locator('.playground').boundingBox();
  assert.ok(starterBox.x + starterBox.width <= panelBox.x + panelBox.width, 'mobile starter picker is not clipped');
  await page.screenshot({ path: '/tmp/py4e-zh-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS mobile navigation, no overflow, no app errors');
  console.log('Screenshots: /tmp/py4e-zh-{home,playground,mobile}.png; external videos not checked.');
} finally {
  await browser.close();
}
