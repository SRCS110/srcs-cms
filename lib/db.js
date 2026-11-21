// Supabase access. The service-role key lives only here, on the server.
import { createClient } from '@supabase/supabase-js';
import { HttpError } from './http.js';

let service;
let anon;

export function db() {
  if (!service) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new HttpError(500, 'CMS database is not configured');
    service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return service;
}

// Public-key client, used only for auth flows (magic links, token refresh).
export function authClient() {
  if (!anon) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new HttpError(500, 'CMS auth is not configured');
    anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' } });
  }
  return anon;
}

export async function loadAllDomains() {
  const { data, error } = await db().from('sites').select('domains').eq('active', true);
  if (error) throw error;
  return data.flatMap((r) => r.domains || []);
}

export async function siteByKey(key) {
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(key)) throw new HttpError(400, 'Invalid site');
  const { data, error } = await db().from('sites').select('*').eq('key', key).maybeSingle();
  if (error) throw error;
  if (!data || !data.active) throw new HttpError(404, 'This site is not set up for editing');
  return data;
}

// Verifies the caller's Supabase access token and returns the user.
export async function requireUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Please sign in');
  const { data, error } = await db().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  return data.user;
}

export async function isAdmin(userId) {
  const { data, error } = await db().from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return !!data;
}

// Returns 'admin' | 'owner' | 'editor', or throws 403.
export async function requireRole(site, user, allowed = ['admin', 'owner', 'editor']) {
  let role = null;
  if (await isAdmin(user.id)) role = 'admin';
  else {
    const { data, error } = await db().from('site_users').select('role').eq('site_id', site.id).eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    role = data?.role || null;
  }
  if (!role || !allowed.includes(role)) throw new HttpError(403, 'You don’t have access to edit this site');
  return role;
}

// Publishing limits: per user per hour, per site per day.
export async function checkRateLimit(site, user) {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const perUser = Number(process.env.CMS_LIMIT_USER_HOUR || 30);
  const perSite = Number(process.env.CMS_LIMIT_SITE_DAY || 100);
  const u = await db().from('edits').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', hourAgo);
  if (u.error) throw u.error;
  if (u.count >= perUser) throw new HttpError(429, 'You’ve published a lot in the last hour. Please wait a bit and try again.');
  const s = await db().from('edits').select('id', { count: 'exact', head: true }).eq('site_id', site.id).gte('created_at', dayAgo);
  if (s.error) throw s.error;
  if (s.count >= perSite) throw new HttpError(429, 'This site has reached today’s publishing limit. Contact Sync Race Studios if you need more.');
}

export function siteRepo(site) {
  return { owner: site.repo_owner, repo: site.repo_name, branch: site.branch || 'main', installationId: site.installation_id };
}

// Is a URL on one of the site's domains?
export function urlOnSite(site, raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)(:|$)/.test(u.host))) return false;
    return (site.domains || []).some((d) => String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') === u.host.toLowerCase());
  } catch {
    return false;
  }
}
