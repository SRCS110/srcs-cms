// POST { site } with the sign-in page's Supabase session → a pass for that one site.
// Only the sign-in page on cms.srcs.online calls this.
import { endpoint, sendJson } from '../lib/http.js';
import { requireUser, siteByKey, requireRole } from '../lib/db.js';
import { mintSiteToken } from '../lib/session.js';
import { aalOf } from '../lib/mfa.js';
import { HttpError } from '../lib/http.js';

export default endpoint({ methods: ['POST'], cors: 'cms' }, async (req, res) => {
  const site = await siteByKey(req.body.site);
  const user = await requireUser(req, site, { supabase: true });
  const role = await requireRole(site, user);
  // Sync Race Studios admins can reach every site, so they must also pass a code
  // from their authenticator app (Supabase MFA, assurance level aal2).
  if (role === 'admin') {
    const token = String(req.headers.authorization || '').slice(7).trim();
    if (aalOf(token) !== 'aal2') throw new HttpError(403, 'Enter the code from your authenticator app to continue.', { code: 'mfa_required' });
  }
  sendJson(res, 200, { ...mintSiteToken(user, site), role, site: { key: site.key, name: site.name, domains: site.domains } });
});
