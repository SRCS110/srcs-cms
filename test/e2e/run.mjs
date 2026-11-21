// End-to-end: sign-in handoff, editing every region type, publish, history/undo, team, visitor view.
// Run: node test/e2e/run.mjs   (needs playwright + Chrome)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { start, stop, urls, state } from './server.mjs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}

const log = (...a) => console.log('✓', ...a);
await start();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
try {
  // ---------- visitor: editor never loads
  const visitor = await browser.newPage();
  const loaded = [];
  visitor.on('request', (r) => loaded.push(r.url()));
  await visitor.goto(urls.site + '/');
  await visitor.waitForLoadState('networkidle');
  assert.ok(loaded.some((u) => u.endsWith('/loader.js')));
  assert.ok(!loaded.some((u) => u.includes('/editor.js')), 'editor must not load for visitors');
  assert.equal(await visitor.locator('[data-srcs-ui]').count(), 0);
  log('visitors get only the loader');
  await visitor.close();

  // ---------- editor
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push('native dialog: ' + d.message()); d.dismiss(); });

  await page.goto(urls.site + '/?edit');
  await page.waitForURL(/login\.html/);
  assert.match(page.url(), /site=demo/);
  log('?edit without a session goes to sign-in');

  await page.fill('#email', 'owner@demo.test');
  await page.click('#send');
  await page.waitForSelector('#sent:not([hidden])');
  log('magic link requested');

  const ret = new URL(page.url()).searchParams.get('return');
  await page.goto('about:blank'); // the email link opens a fresh page
  await page.goto(`${urls.cms}/login.html?site=demo&return=${encodeURIComponent(ret)}#access_token=test-token&refresh_token=r&expires_in=3600&token_type=bearer`);
  await page.waitForURL((u) => u.origin === urls.site);
  const bar = page.locator('.bar');
  await bar.waitFor();
  assert.doesNotMatch(page.url(), /srcs-cms=/, 'token removed from address bar');
  const marked = await page.locator('[data-srcs-ed]').count();
  assert.ok(marked >= 8, `expected editable regions, got ${marked}`);
  log('sign-in handoff lands in edit mode,', marked, 'editable areas');

  // nav links don't navigate
  await page.click('nav a[href="/about.html"]');
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).pathname, '/');
  log('page links are inert while editing');

  // text
  const h1 = page.locator('h1[data-cms]');
  await h1.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Dinner by the river, six nights a week');
  await page.keyboard.press('Enter'); // must not add a line
  assert.equal((await h1.textContent()).trim(), 'Dinner by the river, six nights a week');
  assert.match(await bar.textContent(), /1 change/);
  assert.match(await bar.textContent(), /\/60/);
  log('plain text edit + counter');

  // multiline text
  const hours = page.locator('[data-cms="hours"]');
  await hours.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Sun 4–8 pm');
  log('multiline text edit');

  // global phone
  const phone = page.locator('[data-cms-global="phone"]');
  await phone.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('(707) 555-0100');

  // rich text: bold the first word using the floating toolbar
  const rich = page.locator('[data-cms="about-body"]');
  await rich.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ControlOrMeta+ArrowRight');
  await page.locator('.pop button[title="Bold"]').click();
  assert.match(await rich.innerHTML(), /<b>We\s*<\/b>|<b>We<\/b>|<strong>We/);
  // paste is cleaned to plain text
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const el = document.querySelector('[data-cms="about-body"]');
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', ' Pasted words.');
    dt.setData('text/html', '<span style="color:red">Pasted words.</span>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert.doesNotMatch(await rich.innerHTML(), /color:red/);
  log('rich text bold + clean paste');

  // link
  await page.locator('[data-cms="book-cta"]').click();
  const hrefInput = page.locator('.pop input[aria-label="Button link"]');
  await hrefInput.fill('https://book.example.test/demo');
  log('link href edit');

  // list: duplicate first item, rename it, move it down
  await page.locator('ul.menu > li').first().click({ position: { x: 300, y: 5 } });
  await page.locator('.pop button[title="Duplicate item"]').click();
  assert.equal(await page.locator('ul.menu > li').count(), 3);
  const newName = page.locator('ul.menu > li').nth(1).locator('[data-cms-field="name"]');
  await newName.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Stew');
  log('list duplicate + field edit');

  // image upload
  await page.locator('img[data-cms="hero-img"]').click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.pop input[type=file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: png });
  await page.locator('.pop .note', { hasText: 'Uploaded' }).waitFor();
  assert.equal(await page.locator('img[data-cms="hero-img"]').getAttribute('src'), 'https://cdn.example.test/u/1.webp');
  assert.equal(state.uploads.get('1') > 0, true);
  log('image optimized and uploaded');

  const count = await page.locator('.bar .count').textContent();
  assert.match(count, /7 changes/, count);

  // publish
  await page.locator('.bar .btn.primary').click();
  await page.locator('.pill.busy').waitFor();
  await page.locator('.pill.live').waitFor({ timeout: 20000 });
  assert.match(await page.locator('.bar .count').textContent(), /No changes/);
  const headFiles = state.commits[state.commits.length - 1].files;
  const html = headFiles['index.html'];
  assert.match(html, /<h1 data-cms="hero-title" data-cms-max="60">Dinner by the river, six nights a week<\/h1>/);
  assert.match(html, /Fri–Sat 5–10 pm\nSun 4–8 pm<\/div>/);
  assert.match(html, /<span data-cms-global="phone">\(707\) 555-0100<\/span>/);
  assert.match(headFiles['about.html'], /\(707\) 555-0100/);
  assert.match(html, /<(b|strong)>We\s*<\/(b|strong)>/);
  assert.match(html, /Pasted words\./);
  assert.match(html, /href="https:\/\/book.example.test\/demo">Reserve a table<\/a>/);
  assert.match(html, /<li><strong data-cms-field="name">Soup<\/strong> <span data-cms-field="price">\$8<\/span><\/li>\n    <li><strong data-cms-field="name">Stew<\/strong>/);
  assert.match(html, /src="https:\/\/cdn.example.test\/u\/1.webp" alt="Patio at dusk" width="2" height="2"/);
  assert.doesNotMatch(html, /data-srcs|contenteditable|data-cms-src/, 'editor markers must not leak into the file');
  assert.equal(state.commits.length, 2, 'one commit');
  log('publish → one commit with every change, live status shown');

  // a second edit after publishing uses the new file sha (no false conflict)
  await h1.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('ControlOrMeta+s');
  await page.locator('.pill.live').waitFor({ timeout: 20000 });
  assert.equal(state.commits.length, 3);
  log('second publish (Ctrl/⌘+S) works without a conflict');

  // history + undo
  await page.locator('.bar button', { hasText: 'History' }).click();
  await page.locator('.panel .item').first().waitFor();
  assert.equal(await page.locator('.panel .item').count(), 2);
  await page.locator('.panel .item').first().locator('button', { hasText: 'Undo this' }).click();
  await page.locator('.dialog button.go').click();
  await page.locator('.pill.busy').waitFor();
  await page.locator('.dialog', { hasText: 'Restored' }).waitFor({ timeout: 20000 });
  await page.locator('.dialog button', { hasText: 'Later' }).click();
  assert.equal(state.commits.length, 4);
  assert.doesNotMatch(state.commits[3].files['index.html'], /six nights a week!/);
  assert.match(state.commits[3].files['index.html'], /six nights a week</);
  log('history + undo restores the earlier version');

  // team
  await page.locator('.bar button', { hasText: 'Team' }).click();
  await page.locator('.panel input[type=email]').fill('chef@demo.test');
  await page.locator('.panel button.go').click();
  await page.locator('.panel .item', { hasText: 'chef@demo.test' }).waitFor();
  log('owner can invite an editor');
  await page.keyboard.press('Escape');

  // conflict: someone else changes the file; next publish must be refused
  state.commits.push({ sha: 'f'.repeat(40), parent: state.commits.at(-1).sha, files: { ...state.commits.at(-1).files, 'index.html': state.commits.at(-1).files['index.html'].replace('Not editable', 'Changed elsewhere') } });
  await phone.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ext 2');
  await page.locator('.bar .btn.primary').click();
  await page.locator('.dialog', { hasText: 'This page changed' }).waitFor();
  await page.locator('.dialog button', { hasText: 'Not now' }).click();
  log('stale page publish is refused with a reload prompt');

  // preview hides outlines; done returns to idle pill
  await page.locator('.seg button', { hasText: 'Preview' }).click();
  assert.equal(await page.locator('[data-srcs-ed]').count(), 0);
  await page.locator('.seg button', { hasText: 'Edit' }).click();
  assert.ok(await page.locator('[data-srcs-ed]').count() > 0);
  log('preview toggle');

  // mobile layout: bar fits
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await bar.boundingBox();
  assert.ok(box.width <= 390 && box.x >= 0, 'bar fits on a phone');
  log('bar fits a 390px phone screen');
  await page.screenshot({ path: 'test/.tmp/mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test/.tmp/desktop.png' });

  assert.deepEqual(errors, [], 'no page errors');
  log('no console errors');
  console.log('\nALL E2E CHECKS PASSED');
} catch (e) {
  console.error('E2E FAILED:', e.message);
  if (errors.length) console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  stop();
}
