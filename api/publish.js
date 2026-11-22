// POST { site, file, baseSha, path, changes } — applies edits and commits them to the site repo.
import { endpoint, sendJson, requireString } from '../lib/http.js';
import { db, requireUser, siteByKey, requireRole, checkRateLimit, siteRepo } from '../lib/db.js';
import { repoClient } from '../lib/github.js';
import { assertEditablePath, normalizePagePath } from '../lib/paths.js';
import { publishChanges } from '../lib/publish.js';

export default endpoint({ methods: ['POST'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.body.site);
  const user = await requireUser(req, site);
  await requireRole(site, user);
  await checkRateLimit(site, user);
  const file = assertEditablePath(requireString(req.body.file, 'file', 300), site);
  const pagePath = normalizePagePath(req.body.path || '/');

  const repo = repoClient(siteRepo(site));
  const result = await publishChanges({
    repo, site, file,
    baseSha: typeof req.body.baseSha === 'string' ? req.body.baseSha : null,
    changes: req.body.changes,
    editor: { email: user.email },
  });

  let editId = null;
  if (result.commit) {
    const { data, error } = await db().from('edits').insert({
      site_id: site.id, user_id: user.id, editor_email: user.email, kind: 'edit',
      page_path: pagePath, files: result.files, regions: result.regions, commit_sha: result.commit,
    }).select('id').single();
    if (error) console.error('audit insert failed', error);
    editId = data?.id ?? null;
  }
  sendJson(res, 200, { commit: result.commit, sha: result.sha, files: result.files, editId });
});
