// Maps a page URL path on the live site to the HTML file in the repo.
import { HttpError } from './http.js';

export function normalizePagePath(raw) {
  let p = String(raw || '/');
  try { p = decodeURIComponent(p); } catch { throw new HttpError(400, 'Invalid page path'); }
  p = p.replace(/[?#].*$/, '');
  if (!p.startsWith('/')) p = '/' + p;
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) throw new HttpError(400, 'Invalid page path');
  if (/[\u0000-\u001F\\]/.test(p)) throw new HttpError(400, 'Invalid page path');
  return p.replace(/\/{2,}/g, '/');
}

// Candidate repo files for a page, most likely first.
export function candidateFiles(pagePath, site) {
  const p = normalizePagePath(pagePath);
  const root = String(site.root || '').replace(/^\/+|\/+$/g, '');
  const pre = root ? root + '/' : '';
  const overrides = (site.config && site.config.pages) || {};
  if (overrides[p]) return [String(overrides[p]).replace(/^\/+/, '')];
  const rel = p.slice(1);
  if (rel === '' ) return [pre + 'index.html'];
  if (rel.endsWith('/')) return [pre + rel + 'index.html'];
  if (rel.endsWith('.html')) return [pre + rel];
  return [pre + rel + '.html', pre + rel + '/index.html'];
}

// Is this a file the CMS may write? Keeps edits inside the site's root and to HTML.
export function assertEditablePath(file, site) {
  const root = String(site.root || '').replace(/^\/+|\/+$/g, '');
  if (typeof file !== 'string' || !file.endsWith('.html') || file.includes('..') || file.startsWith('/')) {
    throw new HttpError(400, 'Invalid file');
  }
  if (root && !file.startsWith(root + '/')) throw new HttpError(400, 'Invalid file');
  return file;
}

export async function resolvePageFile(repo, pagePath, site) {
  for (const f of candidateFiles(pagePath, site)) {
    const file = await repo.getFile(f);
    if (file) return file;
  }
  throw new HttpError(404, 'Couldn’t find this page in the site’s files');
}
