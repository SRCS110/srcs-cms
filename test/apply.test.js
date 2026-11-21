import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, listRegions } from '../lib/apply.js';

const page = `<!doctype html>
<html lang="en"><head><title>T</title></head>
<body>
  <!-- untouched comment -->
  <h1 data-cms="hero-title" class="a"   id=x>Old title</h1>
  <p data-cms="about" data-cms-type="rich">Hi <a href="/x">there</a></p>
  <div data-cms="story" data-cms-type="rich"><p>One</p></div>
  <a data-cms="cta" data-cms-type="link" href="/book">Book</a>
  <img data-cms="hero" src="/a.jpg" alt="old" srcset="/a2.jpg 2x" />
  <span data-cms-global="phone">111</span>
  <table><tbody data-cms="rows" data-cms-type="list"><tr><td data-cms-field="n">A</td></tr></tbody></table>
  <ul data-cms="menu" data-cms-type="list">
    <li><h3 data-cms-field="name">Soup</h3> <img data-cms-field="pic" src="/s.jpg" alt="soup"></li>
    <li><h3 data-cms-field="name">Salad</h3> <img data-cms-field="pic" src="/l.jpg" alt="salad"></li>
  </ul>
</body></html>`;

test('only the edited bytes change', () => {
  const { html } = applyChanges(page, [{ key: 'hero-title', value: 'New title' }]);
  assert.equal(html, page.replace('>Old title<', '>New title<'));
});

test('text is escaped, newlines kept', () => {
  const { html } = applyChanges(page, [{ key: 'hero-title', value: '<b>x</b> & "y"\nz' }]);
  assert.match(html, />&lt;b&gt;x&lt;\/b&gt; &amp; "y"\nz<\/h1>/);
});

test('rich text in an inline host keeps only inline tags', () => {
  const { html } = applyChanges(page, [{ key: 'about', value: '<p>One <strong>two</strong></p><p>Three</p><ul><li>x</li></ul>' }]);
  assert.match(html, /<p data-cms="about" data-cms-type="rich">One <strong>two<\/strong><br>Three<br>x<\/p>/);
});

test('rich text in a block host keeps paragraphs and lists, strips scripts and handlers', () => {
  const { html } = applyChanges(page, [{ key: 'story', value: '<p onclick="x()">A</p><script>bad()</script><ul><li>B</li></ul><img src=x onerror=alert(1)><div>C</div>' }]);
  assert.match(html, /data-cms-type="rich"><p>A<\/p><ul><li>B<\/li><\/ul><p>C<\/p><\/div>/);
  assert.doesNotMatch(html, /onclick|script|onerror/);
});

test('unsafe link schemes are dropped from rich text', () => {
  const { html } = applyChanges(page, [{ key: 'story', value: '<a href="javascript:alert(1)">a</a> <a href=" jav&#x09;ascript:x">b</a> <a href="data:text/html,x">c</a> <a href="https://ok.test" target="_blank">ok</a>' }]);
  assert.doesNotMatch(html, /javascript|data:/i);
  assert.match(html, /<a href="https:\/\/ok.test" target="_blank" rel="noopener noreferrer">ok<\/a>/);
});

test('links update text and href', () => {
  const { html } = applyChanges(page, [{ key: 'cta', value: { text: 'Reserve', href: 'https://book.test/?a=1&b=2' } }]);
  assert.match(html, /<a data-cms="cta" data-cms-type="link" href="https:\/\/book.test\/\?a=1&amp;b=2">Reserve<\/a>/);
  assert.throws(() => applyChanges(page, [{ key: 'cta', value: { href: 'javascript:alert(1)' } }]), /not allowed/);
});

test('images update attributes, add missing ones, drop srcset', () => {
  const { html } = applyChanges(page, [{ key: 'hero', value: { src: 'https://cdn.test/n.webp', alt: 'A "b"', width: 1600, height: 900 } }]);
  assert.match(html, /<img data-cms="hero" src="https:\/\/cdn.test\/n.webp" alt="A &quot;b&quot;" width="1600" height="900" \/>/);
  assert.throws(() => applyChanges(page, [{ key: 'hero', value: { src: 'javascript:x' } }]), /not allowed/);
  assert.throws(() => applyChanges(page, [{ key: 'hero', value: { src: 'data:image/png;base64,xx' } }]), /not allowed/);
});

test('globals update every copy', () => {
  const two = page.replace('<span data-cms-global="phone">111</span>', '<span data-cms-global="phone">111</span><b data-cms-global="phone">111</b>');
  const { html } = applyChanges(two, [{ key: 'phone', global: true, value: '222' }]);
  assert.equal((html.match(/>222</g) || []).length, 2);
});

test('lists reorder, duplicate, delete and edit fields', () => {
  const { html } = applyChanges(page, [{ key: 'menu', value: [
    { src: 1 },
    { src: 0, fields: { name: { value: 'Stew' }, pic: { type: 'image', value: { src: 'https://cdn.test/stew.webp', alt: 'stew' } } } },
    { src: 0 },
  ] }]);
  const items = html.match(/<li>.*?<\/li>/g);
  assert.deepEqual(items.map((i) => i.match(/name">([^<]*)/)[1]), ['Salad', 'Stew', 'Soup']);
  assert.match(items[1], /src="https:\/\/cdn.test\/stew.webp" alt="stew"/);
  assert.match(html, /<\/li>\n    <li>/); // original separator kept
});

test('table-row lists survive parsing in context', () => {
  const { html } = applyChanges(page, [{ key: 'rows', value: [{ src: 0, fields: { n: { value: 'B' } } }, { src: 0 }] }]);
  assert.match(html, /<tbody data-cms="rows" data-cms-type="list"><tr><td data-cms-field="n">B<\/td><\/tr><tr><td data-cms-field="n">A<\/td><\/tr><\/tbody>/);
});

test('unknown keys are reported, type mismatches refused', () => {
  const r = applyChanges(page, [{ key: 'nope', value: 'x' }]);
  assert.deepEqual(r.missing, ['nope']);
  assert.equal(r.html, page);
  assert.throws(() => applyChanges(page, [{ key: 'hero', type: 'text', value: 'x' }]), /is image, not text/);
});

test('duplicate keys are refused', () => {
  assert.throws(() => applyChanges(page.replace('data-cms="about"', 'data-cms="hero-title"'), [{ key: 'hero-title', value: 'x' }]), /Duplicate/);
});

test('listRegions sees regions but not list fields', () => {
  const keys = listRegions(page).map((r) => `${r.key}:${r.type}`);
  assert.deepEqual(keys, ['hero-title:text', 'about:rich', 'story:rich', 'cta:link', 'hero:image', 'phone:text', 'rows:list', 'menu:list']);
});
