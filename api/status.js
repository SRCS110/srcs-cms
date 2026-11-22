// GET ?site=&commit= — deploy state of a commit: pending | building | live | failed.
import { endpoint, sendJson, HttpError } from '../lib/http.js';
import { requireUser, siteByKey, requireRole, siteRepo } from '../lib/db.js';
import { repoClient } from '../lib/github.js';

export default endpoint({ methods: ['GET'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.query.site);
  const user = await requireUser(req, site);
  await requireRole(site, user);
  const sha = String(req.query.commit || '');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new HttpError(400, 'Invalid commit');
  const state = await repoClient(siteRepo(site)).deployState(sha);
  sendJson(res, 200, { state });
});
