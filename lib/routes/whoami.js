// GET ?site= with a site pass → who it belongs to. Used server-to-server by the
// srcs.online client-files admin to check a sign-in without holding a full session.
import { endpoint, sendJson } from '../http.js';
import { requireUser, siteByKey, requireRole } from '../db.js';

export default endpoint({ methods: ['GET'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.query.site);
  const user = await requireUser(req, site);
  const role = await requireRole(site, user);
  sendJson(res, 200, { user: { id: user.id, email: user.email }, role, site: site.key });
});
