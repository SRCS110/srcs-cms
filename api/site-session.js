// POST { site } with the sign-in page's Supabase session → a pass for that one site.
// Only the sign-in page on cms.srcs.online calls this.
import { endpoint, sendJson } from '../lib/http.js';
import { requireUser, siteByKey, requireRole } from '../lib/db.js';
import { mintSiteToken } from '../lib/session.js';

export default endpoint({ methods: ['POST'], cors: 'cms' }, async (req, res) => {
  const site = await siteByKey(req.body.site);
  const user = await requireUser(req, site, { supabase: true });
  const role = await requireRole(site, user);
  sendJson(res, 200, { ...mintSiteToken(user, site), role, site: { key: site.key, name: site.name, domains: site.domains } });
});
