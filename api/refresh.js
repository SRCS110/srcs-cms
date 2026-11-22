// Sign-in page only (cms.srcs.online):
//   POST { refresh_token }                 → a fresh Supabase session
//   POST { logout: true } + Bearer session → ends that session and its refresh token
//   POST { mfa: 'status' | 'enroll' | 'verify', factorId?, code? } + Bearer session
//                                          → two-step sign-in for admins
import { endpoint, sendJson, requireString, HttpError } from '../lib/http.js';
import { authClient, db } from '../lib/db.js';
import { mfaStatus, mfaEnroll, mfaVerify } from '../lib/mfa.js';

export default endpoint({ methods: ['POST'], cors: 'cms' }, async (req, res) => {
  const bearer = () => { const h = String(req.headers.authorization || ''); const t = h.startsWith('Bearer ') ? h.slice(7).trim() : ''; if (!t || t.startsWith('scms1.')) throw new HttpError(401, 'Please sign in again'); return t; };
  if (req.body.mfa === 'status') return sendJson(res, 200, await mfaStatus(bearer()));
  if (req.body.mfa === 'enroll') return sendJson(res, 200, await mfaEnroll(bearer()));
  if (req.body.mfa === 'verify') return sendJson(res, 200, await mfaVerify(bearer(), req.body.factorId, req.body.code));
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
