// GET — quick configuration check (no secrets returned).
import { endpoint, sendJson } from '../lib/http.js';

export default endpoint({ methods: ['GET'], cors: 'sites' }, async (req, res) => {
  const has = (k) => !!process.env[k];
  sendJson(res, 200, {
    ok: true,
    configured: {
      supabase: has('SUPABASE_URL') && has('SUPABASE_ANON_KEY') && has('SUPABASE_SERVICE_ROLE_KEY'),
      githubApp: has('GITHUB_APP_ID') && has('GITHUB_APP_PRIVATE_KEY'),
    },
  });
});
