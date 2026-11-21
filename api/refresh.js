// POST { refresh_token } — swaps a refresh token for a fresh session.
import { endpoint, sendJson, requireString, HttpError } from '../lib/http.js';
import { authClient } from '../lib/db.js';

export default endpoint({ methods: ['POST'], cors: 'sites' }, async (req, res) => {
  const refresh_token = requireString(req.body.refresh_token, 'refresh token', 4000);
  const { data, error } = await authClient().auth.refreshSession({ refresh_token });
  if (error || !data?.session) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  const s = data.session;
  sendJson(res, 200, { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at });
});
