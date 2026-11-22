// POST { site, editId } — restores the files an edit changed to how they were before it.
import { endpoint, sendJson, HttpError } from '../lib/http.js';
import { db, requireUser, siteByKey, requireRole, checkRateLimit, siteRepo } from '../lib/db.js';
import { repoClient } from '../lib/github.js';
import { revertEdit } from '../lib/publish.js';

export default endpoint({ methods: ['POST'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.body.site);
  const user = await requireUser(req, site);
  await requireRole(site, user);
  await checkRateLimit(site, user);
  const id = Number(req.body.editId);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid history entry');
  const { data: edit, error } = await db().from('edits').select('*').eq('id', id).eq('site_id', site.id).maybeSingle();
  if (error) throw error;
  if (!edit) throw new HttpError(404, 'History entry not found');

  const result = await revertEdit({ repo: repoClient(siteRepo(site)), edit, editor: { email: user.email } });
  if (!result.commit) return sendJson(res, 200, { commit: null, message: 'Nothing to restore: those areas already match that version.' });
  const ins = await db().from('edits').insert({
    site_id: site.id, user_id: user.id, editor_email: user.email, kind: 'revert',
    page_path: edit.page_path, files: result.files, regions: edit.regions, commit_sha: result.commit, reverts: edit.id,
  }).select('id').single();
  if (ins.error) console.error('audit insert failed', ins.error);
  sendJson(res, 200, { commit: result.commit, files: result.files, editId: ins.data?.id ?? null });
});
