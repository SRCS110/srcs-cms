// Site team management for owners (and SRCS admins).
// GET ?site=  · POST { site, email, role }  · PATCH { site, userId } (resend sign-in link)  · DELETE { site, userId }
import { endpoint, sendJson, requireString, HttpError } from '../lib/http.js';
import { db, requireUser, siteByKey, requireRole, findUserByEmail, signInRedirect, sendAccessEmail } from '../lib/db.js';

export default endpoint({ methods: ['GET', 'POST', 'PATCH', 'DELETE'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.query.site || req.body.site);
  const user = await requireUser(req, site);
  const role = await requireRole(site, user, ['admin', 'owner']);

  if (req.method === 'GET') {
    const { data, error } = await db().from('site_users').select('user_id, email, role, created_at').eq('site_id', site.id).order('created_at');
    if (error) throw error;
    // Mark people who haven't accepted their invite yet.
    const members = await Promise.all(data.map(async (m) => {
      const { data: u } = await db().auth.admin.getUserById(m.user_id).catch(() => ({ data: null }));
      return { ...m, pending: !u?.user?.email_confirmed_at };
    }));
    return sendJson(res, 200, { members, you: user.id });
  }

  if (req.method === 'POST') {
    const email = requireString(req.body.email, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
    const newRole = req.body.role === 'owner' ? 'owner' : 'editor';
    if (newRole === 'owner' && role !== 'admin') throw new HttpError(403, 'Only Sync Race Studios can add owners');

    let target = await findUserByEmail(email);
    let invited = false;
    if (!target) {
      const { data, error } = await db().auth.admin.inviteUserByEmail(email, { redirectTo: signInRedirect(site) });
      if (error) throw new HttpError(502, 'Couldn’t send the invite email. Try again.');
      target = data.user;
      invited = true;
    }
    const { error } = await db().from('site_users').upsert(
      { site_id: site.id, user_id: target.id, email, role: newRole, invited_by: user.id },
      { onConflict: 'site_id,user_id' },
    );
    if (error) throw error;
    return sendJson(res, 200, { ok: true, invited });
  }

  const userId = requireString(req.body.userId, 'user', 64);

  if (req.method === 'PATCH') {
    const { data: row } = await db().from('site_users').select('role').eq('site_id', site.id).eq('user_id', userId).maybeSingle();
    if (!row) throw new HttpError(404, 'That person isn’t on this site');
    const { data: u, error } = await db().auth.admin.getUserById(userId);
    if (error || !u?.user) throw new HttpError(404, 'That person’s account wasn’t found');
    const sent = await sendAccessEmail(site, u.user);
    return sendJson(res, 200, { ok: true, sent });
  }

  // DELETE
  if (userId === user.id && role !== 'admin') throw new HttpError(400, 'You can’t remove yourself');
  const { data: row } = await db().from('site_users').select('role').eq('site_id', site.id).eq('user_id', userId).maybeSingle();
  if (row?.role === 'owner' && role !== 'admin') throw new HttpError(403, 'Only Sync Race Studios can remove an owner');
  const { error } = await db().from('site_users').delete().eq('site_id', site.id).eq('user_id', userId);
  if (error) throw error;
  sendJson(res, 200, { ok: true });
});
