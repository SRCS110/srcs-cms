// Publishing logic, independent of HTTP and of GitHub (any repo adapter works),
// so it can be tested with an in-memory repo.
import { applyChanges } from './apply.js';
import { gitBlobSha } from './github.js';
import { HttpError } from './http.js';
import { ContentError } from './sanitize.js';

export const CONTENT_JSON = 'cms/content.json';

function validateChanges(changes) {
  if (!Array.isArray(changes) || !changes.length) throw new HttpError(400, 'Nothing to publish');
  if (changes.length > 200) throw new HttpError(400, 'Too many changes in one publish');
  const seen = new Set();
  for (const c of changes) {
    if (!c || typeof c.key !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(c.key)) throw new HttpError(400, 'Invalid region key');
    const id = (c.global ? 'g:' : 'k:') + c.key;
    if (seen.has(id)) throw new HttpError(400, `Region "${c.key}" appears twice`);
    seen.add(id);
  }
  return changes.map((c) => ({ key: c.key, global: !!c.global, type: c.type, value: c.value }));
}

function describe(changes) {
  const keys = changes.map((c) => c.key);
  return keys.length <= 4 ? keys.join(', ') : `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`;
}

/**
 * repo: { getFile(path), listFiles(prefix, ext), commitFiles(files, message, author) }
 * Returns { commit, files, sha, regions } — commit is null when nothing changed.
 */
export async function publishChanges({ repo, site, file, baseSha, changes, editor }) {
  const list = validateChanges(changes);
  const main = await repo.getFile(file);
  if (!main) throw new HttpError(404, 'This page no longer exists in the site’s files');
  if (baseSha && main.sha !== baseSha) {
    throw new HttpError(409, 'This page was changed since you opened it. Reload to get the latest version.', { code: 'conflict' });
  }

  const out = new Map();
  const r = applyChanges(main.content, list);
  const missingLocal = r.missing.filter((k) => list.find((c) => c.key === k && !c.global));
  if (missingLocal.length) throw new ContentError(`These areas aren’t editable on this page: ${missingLocal.join(', ')}`);
  if (r.html !== main.content) out.set(file, r.html);

  const globals = list.filter((c) => c.global);
  if (globals.length) {
    const root = String(site.root || '').replace(/^\/+|\/+$/g, '');
    const paths = await repo.listFiles(root ? root + '/' : '', '.html');
    for (const p of paths) {
      if (p === file) continue;
      const f = await repo.getFile(p);
      if (!f || !f.content.includes('data-cms-global')) continue;
      const g = applyChanges(f.content, globals, { onlyGlobals: true });
      if (g.html !== f.content) out.set(p, g.html);
    }
  }

  if (site.mode === 'content-json') {
    // Generator sites: record every value so the build script can re-apply them.
    const existing = await repo.getFile(CONTENT_JSON);
    let data = { version: 1, files: {}, globals: {} };
    if (existing) { try { data = { ...data, ...JSON.parse(existing.content) }; } catch { /* rebuild */ } }
    data.files = data.files || {};
    data.globals = data.globals || {};
    for (const c of list) {
      if (c.global) data.globals[c.key] = { type: c.type, value: c.value };
      else (data.files[file] = data.files[file] || {})[c.key] = { type: c.type, value: c.value };
    }
    if (out.size) out.set(CONTENT_JSON, JSON.stringify(data, null, 2) + '\n');
  }

  if (!out.size) return { commit: null, files: [], sha: main.sha, regions: list.map((c) => c.key) };

  const who = editor?.email || 'unknown editor';
  const message = `CMS: ${describe(list)} on ${file}\n\nEdited by ${who} through the SRCS CMS.`;
  const files = [...out].map(([path, content]) => ({ path, content }));
  const commit = await repo.commitFiles(files, message, editor?.email ? { name: editor.name || editor.email, email: editor.email } : undefined);
  return {
    commit,
    files: files.map((f) => f.path),
    sha: out.has(file) ? gitBlobSha(out.get(file)) : main.sha,
    regions: list.map((c) => c.key),
  };
}

/**
 * Restores the files an edit touched to how they were just before it.
 * repo also needs: parentOf(sha), getFileAt(path, ref)
 */
export async function revertEdit({ repo, edit, editor }) {
  if (!edit.commit_sha) throw new HttpError(400, 'This entry has nothing to revert');
  const parent = await repo.parentOf(edit.commit_sha);
  if (!parent) throw new HttpError(400, 'This edit can’t be reverted');
  const files = [];
  for (const path of edit.files || []) {
    const before = await repo.getFileAt(path, parent);
    const now = await repo.getFile(path);
    // Undo only if the file hasn't changed since this edit. Otherwise restoring the
    // older file would also wipe out everything published after it.
    const after = await repo.getFileAt(path, edit.commit_sha);
    if (now && after && now.content !== after.content) {
      throw new HttpError(409, 'This page has changed since that edit, so undoing it would also undo the later changes. Undo the newer edits first, or ask Sync Race Studios.', { code: 'changed_since' });
    }
    if (before && (!now || now.content !== before.content)) files.push({ path, content: before.content });
  }
  if (!files.length) return { commit: null, files: [] };
  const when = new Date(edit.created_at).toISOString().slice(0, 16).replace('T', ' ');
  const message = `CMS: revert edit from ${when} UTC\n\nRestored by ${editor?.email || 'unknown'} through the SRCS CMS.`;
  const commit = await repo.commitFiles(files, message, editor?.email ? { name: editor.email, email: editor.email } : undefined);
  return { commit, files: files.map((f) => f.path) };
}
