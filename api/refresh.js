// Sign-in page only (cms.srcs.online):
//   POST { refresh_token }                 → a fresh Supabase session
//   POST { logout: true } + Bearer session → ends that session and its refresh token
import { endpoint, sendJson, requireString, HttpError } from '../lib/http.js';
import { authClient, db } from '../lib/db.js';

export default endpoint({ methods: ['POST'], cors: 'cms' }, async (req, res) => {
  if (req.body.logout === true) {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (token) { const { error } = await db().auth.admin.signOut(token, 'local'); if (error) console.warn('logout', error.message); }
    return sendJson(res, 200, { ok: true });
  }
  const refresh_token = requireString(req.body.refresh_token, 'refresh token', 4000);
  const { data, error } = await authClient().auth.refreshSession({ refresh_token });
  if (error || !data?.session) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  const s = data.session;
  sendJson(res, 200, { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
});
