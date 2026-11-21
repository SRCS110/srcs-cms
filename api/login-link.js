// POST { email, site, returnTo } — emails a one-time sign-in link to an invited editor.
import { endpoint, sendJson, requireString, HttpError } from '../lib/http.js';
import { authClient, siteByKey, urlOnSite } from '../lib/db.js';

export default endpoint({ methods: ['POST'], cors: 'cms' }, async (req, res) => {
  const email = requireString(req.body.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
  const site = await siteByKey(req.body.site);
  const returnTo = requireString(req.body.returnTo, 'return address', 2000);
  if (!urlOnSite(site, returnTo)) throw new HttpError(400, 'That return address isn’t part of this site');

  const cms = process.env.CMS_ORIGIN || 'https://cms.srcs.online';
  const redirect = `${cms}/login.html?site=${encodeURIComponent(site.key)}&return=${encodeURIComponent(returnTo)}`;
  const { error } = await authClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirect } });
  if (error) {
    if (error.status === 429) throw new HttpError(429, 'Too many sign-in emails. Wait a minute and try again.');
    // Unknown emails get the same answer, so the form can't be used to discover who has access.
    console.warn('login-link', error.status, error.message);
  }
  sendJson(res, 200, { ok: true });
});
