// GET ?site=&path= — who is signed in, their role, and the repo file behind this page.
import { endpoint, sendJson } from '../lib/http.js';
import { requireUser, siteByKey, requireRole, siteRepo } from '../lib/db.js';
import { agentForSite } from '../lib/agent.js';
import { repoClient } from '../lib/github.js';
import { resolvePageFile } from '../lib/paths.js';
import { listRegions } from '../lib/apply.js';

export default endpoint({ methods: ['GET'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.query.site);
  const user = await requireUser(req, site);
  const role = await requireRole(site, user);
  const out = {
    site: { key: site.key, name: site.name, mode: site.mode, domains: site.domains },
    user: { email: user.email, role },
  };
  const agent = await agentForSite(site.id).catch(() => null);
  if (agent?.active) out.agent = { key: agent.key };
  if (req.query.path) {
    const repo = repoClient(siteRepo(site));
    const file = await resolvePageFile(repo, req.query.path, site);
    out.file = file.path;
    out.sha = file.sha;
    out.regions = listRegions(file.content).map((r) => ({ key: r.key, global: r.global, type: r.type }));
  }
  sendJson(res, 200, out);
});
