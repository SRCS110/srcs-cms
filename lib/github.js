// GitHub App client: short-lived installation tokens, file reads, atomic multi-file commits,
// and deploy status lookups. No personal tokens anywhere.
import crypto from 'node:crypto';
import { HttpError } from './http.js';

const API = 'https://api.github.com';
const tokenCache = new Map(); // installationId -> { token, exp }

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let keyObject = null;

// Accepts the .pem however it was pasted: real newlines, literal "\n", spaces
// instead of newlines, wrapped in quotes, or the whole file base64-encoded.
export function normalizePem(raw) {
  let s = String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  if (!s.includes('-----BEGIN')) {
    try { const d = Buffer.from(s, 'base64').toString('utf8'); if (d.includes('-----BEGIN')) s = d.trim(); } catch {}
  }
  const m = s.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return s;
  const body = m[2].replace(/\s+/g, '');
  return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${m[1]}-----\n`;
}

function privateKey() {
  if (keyObject) return keyObject;
  const raw = process.env.GITHUB_APP_PRIVATE_KEY || '';
  if (!raw) throw new HttpError(500, 'GitHub App is not configured');
  try {
    const pem = normalizePem(raw);
    if (pem.includes('-----BEGIN')) keyObject = crypto.createPrivateKey(pem);
    else {
      // Body pasted without the BEGIN/END lines: read it as raw DER.
      const der = Buffer.from(pem.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
      try { keyObject = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs1' }); }
      catch { keyObject = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }); }
    }
  } catch (e) {
    // Shape only, never the key itself. A complete 2048-bit key is about 1,190 bytes of DER.
    const der = Buffer.from(String(raw).replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
    console.error('GITHUB_APP_PRIVATE_KEY unreadable', { length: raw.length, hasBegin: raw.includes('-----BEGIN'), hasEnd: raw.includes('-----END'), newlines: (raw.match(/\n/g) || []).length, derBytes: der.length, code: e.code });
    throw new HttpError(500, 'The CMS can’t read its GitHub key. Contact Sync Race Studios.');
  }
  return keyObject;
}

function appJwt() {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new HttpError(500, 'GitHub App is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(privateKey()).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${payload}.${sig}`;
}

async function gh(method, path, { token, body, accept, allow = [] } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: accept || 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'srcs-cms',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow.includes(res.status)) return { status: res.status, data: null };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new HttpError(res.status === 404 ? 404 : 502, res.status === 404 ? 'Not found on GitHub' : `GitHub error ${res.status}`);
    err.github = { status: res.status, path, text: text.slice(0, 500) };
    throw err;
  }
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

// Tokens are scoped to the one repository being edited (when given), so a token
// minted for one client site can never write to another repo the App can reach.
export async function installationToken(installationId, repo) {
  const id = String(installationId || process.env.GITHUB_INSTALLATION_ID || '');
  if (!id) throw new HttpError(500, 'Site has no GitHub App installation');
  const key = `${id}:${repo || '*'}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp - Date.now() > 5 * 60 * 1000) return hit.token;
  const body = repo ? { repositories: [repo] } : { permissions: { metadata: 'read' } };
  const { data } = await gh('POST', `/app/installations/${id}/access_tokens`, { token: appJwt(), body });
  tokenCache.set(key, { token: data.token, exp: Date.parse(data.expires_at) });
  return data.token;
}

// git's blob id for a UTF-8 string (lets us return the new file SHA without another request).
export function gitBlobSha(content) {
  const buf = Buffer.from(content, 'utf8');
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

export function repoClient({ owner, repo, branch = 'main', installationId }) {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const tok = () => installationToken(installationId, repo);

  async function getFileAt(path, ref) {
    const token = await tok();
    const { status, data } = await gh('GET', `${base}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, { token, allow: [404] });
    if (status === 404 || !data || Array.isArray(data) || data.type !== 'file') return null;
    let b64 = data.content;
    if (!b64 && data.size > 0) {
      // Files over 1 MB come back without content: fetch the blob.
      const blob = await gh('GET', `${base}/git/blobs/${data.sha}`, { token });
      b64 = blob.data.content;
    }
    return { path, sha: data.sha, content: Buffer.from(b64 || '', 'base64').toString('utf8') };
  }

  async function head() {
    const token = await tok();
    const ref = await gh('GET', `${base}/git/ref/heads/${enc(branch)}`, { token });
    const commit = await gh('GET', `${base}/git/commits/${ref.data.object.sha}`, { token });
    return { sha: ref.data.object.sha, treeSha: commit.data.tree.sha };
  }

  return {
    owner, repo, branch,
    getFile: (path) => getFileAt(path, branch),
    getFileAt,

    async exists(path) {
      const token = await tok();
      const { status } = await gh('GET', `${base}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`, { token, allow: [404] });
      return status !== 404;
    },

    async listFiles(prefix = '', ext = '.html', limit = 400) {
      const token = await tok();
      const h = await head();
      const { data } = await gh('GET', `${base}/git/trees/${h.treeSha}?recursive=1`, { token });
      return data.tree
        .filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith(ext))
        .slice(0, limit)
        .map((e) => e.path);
    },

    async parentOf(sha) {
      const token = await tok();
      const { data } = await gh('GET', `${base}/git/commits/${sha}`, { token });
      return data.parents?.[0]?.sha || null;
    },

    // One commit for all files. Retries once if the branch moved underneath us.
    async commitFiles(files, message, author) {
      const token = await tok();
      for (let attempt = 0; attempt < 2; attempt++) {
        const h = await head();
        const tree = await gh('POST', `${base}/git/trees`, {
          token,
          body: { base_tree: h.treeSha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) },
        });
        const commit = await gh('POST', `${base}/git/commits`, {
          token,
          body: { message, tree: tree.data.sha, parents: [h.sha], ...(author ? { author: { ...author, date: new Date().toISOString() } } : {}) },
        });
        const upd = await gh('PATCH', `${base}/git/refs/heads/${enc(branch)}`, { token, body: { sha: commit.data.sha, force: false }, allow: [409, 422] });
        if (upd.status === 200) return commit.data.sha;
      }
      throw new HttpError(409, 'The site was updated by someone else at the same moment. Try publishing again.');
    },

    // Maps Vercel's GitHub reporting to pending | building | live | failed.
    async deployState(sha) {
      const token = await tok();
      const st = await gh('GET', `${base}/commits/${sha}/status`, { token, allow: [404, 422] });
      const vercel = (st.data?.statuses || []).filter((s) => /vercel/i.test(s.context || '') && !/preview|comment/i.test(s.context || ''));
      if (vercel.length) {
        const states = vercel.map((s) => s.state);
        if (states.some((s) => s === 'failure' || s === 'error')) return 'failed';
        if (states.every((s) => s === 'success')) return 'live';
        return 'building';
      }
      const deps = await gh('GET', `${base}/deployments?sha=${sha}&per_page=10`, { token, allow: [404, 403] });
      const prod = (deps.data || []).find((d) => /production/i.test(d.environment || '')) || (deps.data || [])[0];
      if (prod) {
        const ds = await gh('GET', `${base}/deployments/${prod.id}/statuses?per_page=1`, { token, allow: [404, 403] });
        const s = ds.data?.[0]?.state;
        if (s === 'success') return 'live';
        if (s === 'failure' || s === 'error') return 'failed';
        return 'building';
      }
      return 'pending';
    },
  };
}
