// GET — configuration check. Returns only booleans, never secrets.
import { endpoint, sendJson } from '../lib/http.js';
import { installationToken } from '../lib/github.js';

export default endpoint({ methods: ['GET'], cors: 'sites' }, async (req, res) => {
  const has = (k) => !!process.env[k];
  let githubAuth = false;
  if (has('GITHUB_APP_ID') && has('GITHUB_APP_PRIVATE_KEY') && has('GITHUB_INSTALLATION_ID')) {
    try { githubAuth = !!(await installationToken()); } catch (e) { console.error('health: github auth failed', e.message); }
  }
  sendJson(res, 200, {
    ok: true,
    configured: {
      supabase: has('SUPABASE_URL') && has('SUPABASE_ANON_KEY') && has('SUPABASE_SERVICE_ROLE_KEY'),
      githubApp: has('GITHUB_APP_ID') && has('GITHUB_APP_PRIVATE_KEY'),
    },
    githubAuth,
  });
});
