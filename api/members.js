// Site team management for owners (and SRCS admins).
// GET ?site=  · POST { site, email, role }  · DELETE { site, userId }
import { endpoint, sendJson, requireString, HttpError } from '../lib/http.js';
import { db, requireUser, siteByKey, requireRole } from '../lib/db.js';

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

export default endpoint({ methods: ['GET', 'POST', 'DELETE'], cors: 'sites' }, async (req, res) => {
  const user = await requireUser(req);
  const site = await siteByKey(req.query.site || req.body.site);
  const role = await requireRole(site, user, ['admin', 'owner']);

  if (req.method === 'GET') {
    const { data, error } = await db().from('site_users').select('user_id, email, role, created_at').eq('site_id', site.id).order('created_at');
    if (error) throw error;
    return sendJson(res, 200, { members: data, you: user.id });
  }

  if (req.method === 'POST') {
    const email = requireString(req.body.email, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
    const newRole = req.body.role === 'owner' ? 'owner' : 'editor';
    if (newRole === 'owner' && role !== 'admin') throw new HttpError(403, 'Only Sync Race Studios can add owners');

    let target = await findUserByEmail(email);
    let invited = false;
    if (!target) {
      const cms = process.env.CMS_ORIGIN || 'https://cms.srcs.online';
      const home = `https://${String(site.domains?.[0] || '').replace(/^https?:\/\//, '')}/?edit`;
      const redirectTo = `${cms}/login.html?site=${encodeURIComponent(site.key)}&return=${encodeURIComponent(home)}`;
      const { data, error } = await db().auth.admin.inviteUserByEmail(email, { redirectTo });
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

  // DELETE
  const userId = requireString(req.body.userId, 'user', 64);
  if (userId === user.id && role !== 'admin') throw new HttpError(400, 'You can’t remove yourself');
  const { data: row } = await db().from('site_users').select('role').eq('site_id', site.id).eq('user_id', userId).maybeSingle();
  if (row?.role === 'owner' && role !== 'admin') throw new HttpError(403, 'Only Sync Race Studios can remove an owner');
  const { error } = await db().from('site_users').delete().eq('site_id', site.id).eq('user_id', userId);
  if (error) throw error;
  sendJson(res, 200, { ok: true });
});
