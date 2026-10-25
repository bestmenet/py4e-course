/* Run after building Pages and serving it locally. No browser downloads needed
   when CHROMIUM_PATH points to an installed Chromium. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = (process.env.PY4E_TEST_URL || 'http://127.0.0.1:8000/py4e-course/').replace(/\/?$/, '/');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('py4e:language', 'en'));
try {
  await page.goto(base + 'playground/');
  const editor = page.locator('textarea.editor');
  const output = page.locator('.console');
  const runButton = page.getByRole('button', { name: 'Run', exact: true });
  await editor.waitFor();

  // Both modes and an intentionally empty draft must survive an immediate reload.
  await editor.fill("print('saved draft')\n");
  await page.reload();
  await assert.equal(await editor.inputValue(), "print('saved draft')\n");
  await editor.fill('');
  await page.reload();
  assert.equal(await editor.inputValue(), '');
  await page.locator('select[aria-label="Load a starter program"]').selectOption('repl');
  await page.reload();
  assert.equal(await page.locator('[data-mode="repl"]').getAttribute('aria-pressed'), 'true');
  assert.match(await editor.inputValue(), /^>>>/);

  const starters = [
    ['hello', /Hello, world/], ['files', /From: lines in mbox.txt: 1797/],
    ['repl', /a 1\nb 2/], ['dict', /3 the/],
    ['regex', /stephen\.marquard@uct\.ac\.za/], ['sqlite', /Thunderstruck.*20/],
    ['url', /'But': 1/],
  ];
  for (const [id, expected] of starters) {
    await page.locator('select[aria-label="Load a starter program"]').selectOption(id);
    assert.equal(await page.locator(`[data-mode="${id === 'repl' ? 'repl' : 'script'}"]`).getAttribute('aria-pressed'), 'true');
    await runButton.click();
    await page.waitForFunction(() => !document.querySelector('.playground .btn-primary').disabled, null, { timeout: 100000 });
    assert.match(await output.textContent(), expected, `starter: ${id}`);
    assert.equal(await output.locator('.err').count(), 0, `starter: ${id}`);
    console.log(`PASS starter ${id}`);
  }

  await editor.fill("print(input('Name? '))\n");
  await page.locator('textarea[aria-label="Standard input"]').fill('Ada');
  await runButton.click();
  await page.waitForFunction(() => !document.querySelector('.playground .btn-primary').disabled);
  assert.equal(await output.textContent(), 'Name? Ada\n');
  console.log('PASS stdin');

  const results = await page.evaluate(async () => {
    const { api } = await import(new URL('assets/js/api.js', document.baseURI));
    return {
      files: await api.run({ code: "print(open('custom.txt').read())", files: { 'custom.txt': 'custom data' } }),
      error: await api.run({ code: 'raise ValueError("expected error")' }),
      truncation: await api.run({ code: 'print("x" * 70000)' }),
      timeout: await api.run({ code: 'while True: pass', timeout: 0.5 }),
      recovery: await api.run({ code: 'print("recovered")' }),
    };
  });
  assert.equal(results.files.stdout, 'custom data\n');
  assert.equal(results.error.exit_code, 1);
  assert.match(results.error.stderr, /ValueError: expected error/);
  assert.equal(results.truncation.truncated, true);
  assert.equal(results.truncation.stdout.length, 65536);
  assert.equal(results.timeout.timed_out, true);
  assert.equal(results.timeout.exit_code, null);
  assert.equal(results.recovery.stdout, 'recovered\n');
  assert.equal(results.recovery.ok, true);
  assert.deepEqual(errors, []);
  console.log('PASS extra files, errors, output cap, timeout, recovery, no page errors');
} finally {
  await browser.close();
}
