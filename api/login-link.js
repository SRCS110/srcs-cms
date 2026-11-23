// POST { email, site, returnTo } — emails a one-time sign-in link to an invited editor.
import { endpoint, sendJson, requireString, HttpError } from '../lib/http.js';
import { authClient, db, siteByKey, urlOnSite, findUserByEmail, sendAccessEmail } from '../lib/db.js';

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
    // Invited but never accepted: Supabase refuses a sign-in link (it counts as a
    // sign-up), so send that person a fresh invite instead, if they belong to this site.
    if (error.code === 'signup_disabled' || error.status === 422) {
      const u = await findUserByEmail(email).catch(() => null);
      if (u && !u.email_confirmed_at) {
        const { data: member } = await db().from('site_users').select('user_id').eq('site_id', site.id).eq('user_id', u.id).maybeSingle();
        if (member) {
          await sendAccessEmail(site, u, returnTo).catch((e) => console.warn('login-link invite', e.message));
          return sendJson(res, 200, { ok: true });
        }
      }
    }
    // Unknown emails get the same answer, so the form can't be used to discover who has access.
    console.warn('login-link', error.status, error.message);
  }
  sendJson(res, 200, { ok: true });
});
