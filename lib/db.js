// Supabase access. The service-role key lives only here, on the server.
import { createClient } from '@supabase/supabase-js';
import { HttpError } from './http.js';
import { isSiteToken, verifySiteToken } from './session.js';

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

/**
 * Who is calling. Client sites send a site pass (see session.js) that only works
 * for the site it was issued for. A full Supabase sign-in is accepted only where
 * the endpoint asks for it (the sign-in page on cms.srcs.online).
 */
export async function requireUser(req, site, { supabase = false } = {}) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Please sign in');
  if (isSiteToken(token)) {
    if (supabase) throw new HttpError(401, 'Please sign in again');
    const p = verifySiteToken(token);
    if (!p) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (!site || p.site !== site.key) throw new HttpError(401, 'This sign-in is for a different site. Please sign in again.');
    return { id: p.sub, email: p.email };
  }
  if (!supabase) throw new HttpError(401, 'Please sign in again');
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

// Find an auth user by email (lower-cased). Pages through the admin list.
export async function findUserByEmail(email) {
  const want = String(email || '').toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === want);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

// Where an email link for this site lands: the CMS sign-in page, then back to the site.
export function signInRedirect(site, returnTo) {
  const cms = process.env.CMS_ORIGIN || 'https://cms.srcs.online';
  const home = returnTo || `https://${String(site.domains?.[0] || '').replace(/^https?:\/\//, '')}/?edit`;
  return `${cms}/login.html?site=${encodeURIComponent(site.key)}&return=${encodeURIComponent(home)}`;
}

// Email a user a way in. Someone who never accepted their invite can't get a
// normal sign-in link (Supabase treats it as a new sign-up, which is off), so
// they get a fresh invite instead. Returns 'invite' or 'link'.
export async function sendAccessEmail(site, user, returnTo) {
  const redirectTo = signInRedirect(site, returnTo);
  if (!user.email_confirmed_at) {
    const { error } = await db().auth.admin.inviteUserByEmail(user.email, { redirectTo });
    if (error) throw new HttpError(error.status === 429 ? 429 : 502, error.status === 429 ? 'Too many emails. Wait a minute and try again.' : 'Couldn’t send the invite email. Try again.');
    return 'invite';
  }
  const { error } = await authClient().auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
  if (error) throw new HttpError(error.status === 429 ? 429 : 502, error.status === 429 ? 'Too many emails. Wait a minute and try again.' : 'Couldn’t send the sign-in email. Try again.');
  return 'link';
}
