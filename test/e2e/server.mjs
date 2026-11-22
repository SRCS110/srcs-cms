// Local stand-in for the CMS API + a sample client site, for browser tests.
// Uses the real publish/apply logic against an in-memory repo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishChanges, revertEdit } from '../../lib/publish.js';
import { listRegions } from '../../lib/apply.js';
import { gitBlobSha } from '../../lib/github.js';
import { candidateFiles } from '../../lib/paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '../../public');
const SITE_PORT = Number(process.env.SITE_PORT || 4601);
const CMS_PORT = Number(process.env.CMS_PORT || 4602);
const CMS = `http://localhost:${CMS_PORT}`;

const page = fs.readFileSync(path.join(here, 'site.html'), 'utf8').replaceAll('__CMS__', CMS);
const files = { 'index.html': page, 'about.html': '<html><body><p>About us</p><span data-cms-global="phone">(707) 555-0142</span></body></html>' };
const commits = [{ sha: 'c'.repeat(40), parent: null, files: { ...files } }];
const head = () => commits[commits.length - 1].files;
const fileObj = (all, p) => (p in all ? { path: p, sha: gitBlobSha(all[p]), content: all[p] } : null);
const repo = {
  getFile: async (p) => fileObj(head(), p),
  getFileAt: async (p, ref) => fileObj(commits.find((c) => c.sha === ref)?.files || {}, p),
  listFiles: async (pre, ext) => Object.keys(head()).filter((p) => p.startsWith(pre) && p.endsWith(ext)),
  parentOf: async (sha) => commits.find((c) => c.sha === sha)?.parent || null,
  commitFiles: async (list, message) => {
    const next = { ...head() };
    for (const f of list) next[f.path] = f.content;
    const sha = (commits.length.toString(16)).padStart(40, '0');
    commits.push({ sha, parent: commits[commits.length - 1].sha, files: next, message });
    return sha;
  },
};
const site = { key: 'demo', name: 'Demo Bistro', root: '', mode: 'html', domains: [`localhost:${SITE_PORT}`] };
const edits = [];
const polls = new Map();
const uploads = new Map();
export const state = { commits, edits, uploads, members: [{ user_id: 'u1', email: 'owner@demo.test', role: 'owner' }] };

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': `http://localhost:${SITE_PORT}`, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-upsert', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS' }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const cms = http.createServer(async (req, res) => {
  const url = new URL(req.url, CMS);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (url.pathname.startsWith('/api/')) {
    const authed = req.headers.authorization === 'Bearer scms1.site-pass';
    const raw = await body(req);
    const b = raw.length && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : {};
    try {
      switch (url.pathname) {
        case '/api/login-link': return json(res, 200, { ok: true });
        case '/api/refresh': return json(res, 200, { access_token: 'test-token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 });
        case '/api/site-session':
          if (req.headers.authorization !== 'Bearer test-token') return json(res, 401, { error: 'Please sign in' });
          return json(res, 200, { access_token: 'scms1.site-pass', expires_at: Math.floor(Date.now() / 1000) + 12 * 3600, role: 'owner', site: { key: site.key, name: site.name, domains: site.domains } });
      }
      if (url.pathname === '/api/upload-put') {
        uploads.set(url.searchParams.get('id'), raw.length);
        return json(res, 200, { Key: 'x' });
      }
      if (!authed) return json(res, 401, { error: 'Please sign in' });
      switch (url.pathname) {
        case '/api/session': {
          const out = { site: { key: site.key, name: site.name, mode: site.mode, domains: site.domains }, user: { email: 'owner@demo.test', role: 'owner' } };
          if (url.searchParams.get('path')) {
            const f = await repo.getFile(candidateFiles(url.searchParams.get('path'), site)[0]);
            if (!f) return json(res, 404, { error: 'not found' });
            Object.assign(out, { file: f.path, sha: f.sha, regions: listRegions(f.content).map((r) => ({ key: r.key, global: r.global, type: r.type })) });
          }
          return json(res, 200, out);
        }
        case '/api/publish': {
          const r = await publishChanges({ repo, site, file: b.file, baseSha: b.baseSha, changes: b.changes, editor: { email: 'owner@demo.test' } });
          if (r.commit) edits.unshift({ id: edits.length + 1, kind: 'edit', editor_email: 'owner@demo.test', page_path: b.path, regions: r.regions, files: r.files, commit_sha: r.commit, created_at: new Date().toISOString() });
          return json(res, 200, { ...r, editId: edits.length });
        }
        case '/api/status': {
          const n = (polls.get(url.searchParams.get('commit')) || 0) + 1;
          polls.set(url.searchParams.get('commit'), n);
          return json(res, 200, { state: n >= 2 ? 'live' : 'building' });
        }
        case '/api/history': return json(res, 200, { edits });
        case '/api/revert': {
          const e = edits.find((x) => x.id === b.editId);
          const r = await revertEdit({ repo, edit: e, editor: { email: 'owner@demo.test' } });
          if (r.commit) edits.unshift({ id: edits.length + 1, kind: 'revert', editor_email: 'owner@demo.test', page_path: e.page_path, regions: e.regions, files: r.files, commit_sha: r.commit, created_at: new Date().toISOString() });
          return json(res, 200, r);
        }
        case '/api/upload-url': {
          const id = String(uploads.size + 1);
          return json(res, 200, { uploadUrl: `${CMS}/api/upload-put?id=${id}`, headers: { apikey: 'anon' }, publicUrl: `https://cdn.example.test/u/${id}.webp` });
        }
        case '/api/members': {
          if (req.method === 'POST') { state.members.push({ user_id: 'u' + (state.members.length + 1), email: b.email, role: 'editor' }); return json(res, 200, { ok: true, invited: true }); }
          if (req.method === 'DELETE') { state.members = state.members.filter((m) => m.user_id !== b.userId); return json(res, 200, { ok: true }); }
          return json(res, 200, { members: state.members, you: 'u1' });
        }
      }
      return json(res, 404, { error: 'no route' });
    } catch (e) {
      return json(res, e.status || (e.name === 'ContentError' ? 422 : 500), { error: e.message, ...(e.extra || {}) });
    }
  }
  const p = path.join(pub, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!p.startsWith(pub) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const siteServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${SITE_PORT}`);
  if (url.pathname === '/hero.png' || url.pathname === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  // Serve what was "deployed": the latest commit.
  if (!(name in head())) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(head()[name]);
});

export function start() {
  return Promise.all([new Promise((r) => cms.listen(CMS_PORT, r)), new Promise((r) => siteServer.listen(SITE_PORT, r))]);
}
export function stop() { cms.close(); siteServer.close(); }
export const urls = { site: `http://localhost:${SITE_PORT}`, cms: CMS };

if (process.argv[1] === fileURLToPath(import.meta.url)) start().then(() => console.log('site', urls.site, 'cms', urls.cms));
