// GET ?site= — the 50 most recent publishes and reverts.
import { endpoint, sendJson } from '../lib/http.js';
import { db, requireUser, siteByKey, requireRole } from '../lib/db.js';

export default endpoint({ methods: ['GET'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.query.site);
  const user = await requireUser(req, site);
  await requireRole(site, user);
  const { data, error } = await db().from('edits')
    .select('id, kind, editor_email, page_path, regions, files, commit_sha, reverts, created_at')
    .eq('site_id', site.id).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  sendJson(res, 200, { edits: data });
});
