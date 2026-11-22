import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishChanges, revertEdit, CONTENT_JSON } from '../lib/publish.js';
import { gitBlobSha } from '../lib/github.js';
import { candidateFiles, normalizePagePath, assertEditablePath } from '../lib/paths.js';

function memoryRepo(files) {
  const commits = [{ sha: 'c0', parent: null, files: { ...files } }];
  const headFiles = () => commits[commits.length - 1].files;
  const file = (all, path) => (path in all ? { path, sha: gitBlobSha(all[path]), content: all[path] } : null);
  return {
    commits,
    async getFile(path) { return file(headFiles(), path); },
    async getFileAt(path, ref) { const c = commits.find((x) => x.sha === ref); return c ? file(c.files, path) : null; },
    async listFiles(prefix, ext) { return Object.keys(headFiles()).filter((p) => p.startsWith(prefix) && p.endsWith(ext)); },
    async parentOf(sha) { return commits.find((c) => c.sha === sha)?.parent || null; },
    async commitFiles(list, message) {
      const next = { ...headFiles() };
      for (const f of list) next[f.path] = f.content;
      const sha = 'c' + commits.length;
      commits.push({ sha, parent: commits[commits.length - 1].sha, files: next, message });
      return sha;
    },
  };
}

const index = '<html><body><h1 data-cms="t">Hello</h1><span data-cms-global="phone">1</span></body></html>';
const about = '<html><body><p>About</p><span data-cms-global="phone">1</span></body></html>';
const site = { root: '', mode: 'html' };

test('publishes one commit, updates globals across pages, returns new sha', async () => {
  const repo = memoryRepo({ 'index.html': index, 'about.html': about, 'x.css': '' });
  const r = await publishChanges({ repo, site, file: 'index.html', baseSha: gitBlobSha(index), editor: { email: 'a@b.co' },
    changes: [{ key: 't', value: 'Hi' }, { key: 'phone', global: true, value: '2' }] });
  assert.equal(repo.commits.length, 2);
  assert.deepEqual(r.files.sort(), ['about.html', 'index.html']);
  const head = repo.commits[1].files;
  assert.match(head['index.html'], />Hi<.*>2</);
  assert.match(head['about.html'], />2</);
  assert.equal(r.sha, gitBlobSha(head['index.html']));
  assert.match(repo.commits[1].message, /Edited by a@b.co/);
});

test('rejects a stale base sha', async () => {
  const repo = memoryRepo({ 'index.html': index });
  await assert.rejects(publishChanges({ repo, site, file: 'index.html', baseSha: 'stale', changes: [{ key: 't', value: 'x' }] }), (e) => e.status === 409);
});

test('rejects unknown regions and empty publishes', async () => {
  const repo = memoryRepo({ 'index.html': index });
  await assert.rejects(publishChanges({ repo, site, file: 'index.html', changes: [{ key: 'missing', value: 'x' }] }), /aren’t editable/);
  await assert.rejects(publishChanges({ repo, site, file: 'index.html', changes: [] }), (e) => e.status === 400);
});

test('no commit when nothing changes', async () => {
  const repo = memoryRepo({ 'index.html': index });
  const r = await publishChanges({ repo, site, file: 'index.html', changes: [{ key: 't', value: 'Hello' }] });
  assert.equal(r.commit, null);
  assert.equal(repo.commits.length, 1);
});

test('content-json mode records values for the build', async () => {
  const repo = memoryRepo({ 'index.html': index });
  await publishChanges({ repo, site: { ...site, mode: 'content-json' }, file: 'index.html', changes: [{ key: 't', value: 'Yo' }, { key: 'phone', global: true, value: '9' }] });
  const data = JSON.parse(repo.commits[1].files[CONTENT_JSON]);
  assert.equal(data.files['index.html'].t.value, 'Yo');
  assert.equal(data.globals.phone.value, '9');
});

test('revert restores files to before the edit', async () => {
  const repo = memoryRepo({ 'index.html': index });
  const r = await publishChanges({ repo, site, file: 'index.html', changes: [{ key: 't', value: 'Changed' }] });
  const back = await revertEdit({ repo, edit: { commit_sha: r.commit, files: r.files, created_at: new Date().toISOString() }, editor: { email: 'a@b.co' } });
  assert.ok(back.commit);
  assert.equal(repo.commits[repo.commits.length - 1].files['index.html'], index);
});

test('page paths map to repo files and stay inside the site', () => {
  assert.deepEqual(candidateFiles('/', { root: '' }), ['index.html']);
  assert.deepEqual(candidateFiles('/about', { root: '' }), ['about.html', 'about/index.html', 'pages/about.html']);
  assert.deepEqual(candidateFiles('/pages/services.html', { root: 'public' }), ['public/pages/services.html']);
  assert.deepEqual(candidateFiles('/team/', { root: '' }), ['team/index.html']);
  assert.deepEqual(candidateFiles('/x', { root: '', config: { pages: { '/x': 'special.html' } } }), ['special.html']);
  assert.throws(() => normalizePagePath('/../secret'));
  assert.throws(() => normalizePagePath('/%2e%2e/secret'));
  assert.throws(() => assertEditablePath('../x.html', { root: '' }));
  assert.throws(() => assertEditablePath('api/x.js', { root: '' }));
  assert.throws(() => assertEditablePath('other/x.html', { root: 'public' }));
});

test('undo is refused when the page changed after that edit', async () => {
  const repo = memoryRepo({ 'index.html': index });
  const first = await publishChanges({ repo, site, file: 'index.html', changes: [{ key: 't', value: 'First' }] });
  await publishChanges({ repo, site, file: 'index.html', changes: [{ key: 't', value: 'Second' }] });
  await assert.rejects(revertEdit({ repo, edit: { commit_sha: first.commit, files: first.files, created_at: new Date().toISOString() }, editor: { email: 'a@b.co' } }), /changed since that edit/);
});
