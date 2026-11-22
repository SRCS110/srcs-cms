// Site sessions. The real sign-in (Supabase) stays on cms.srcs.online; each client
// site only ever receives a short-lived pass that is valid for that one site.
// A pass stolen from one site can't be used on any other site, can't be renewed,
// and expires on its own.
import crypto from 'node:crypto';
import { HttpError } from './http.js';

const PREFIX = 'scms1.';
export const SITE_SESSION_HOURS = 12;
// Passes issued before this moment are refused (raise it to sign everyone out of
// every site at once). Set when the authenticator code became required for all editors.
const NOT_BEFORE = 1795378351;

let key;
function signingKey() {
  if (!key) {
    // A dedicated secret if set; otherwise derived from the service-role key,
    // which never leaves the server. Rotating either one signs everyone out.
    const s = process.env.CMS_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!s) throw new HttpError(500, 'CMS sessions are not configured');
    key = crypto.createHmac('sha256', s).update('srcs-cms site session v1').digest();
  }
  return key;
}

const sign = (body) => crypto.createHmac('sha256', signingKey()).update(PREFIX + body).digest();

export function mintSiteToken(user, site) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, sub: user.id, email: user.email, site: site.key, iat: now, exp: now + SITE_SESSION_HOURS * 3600, jti: crypto.randomUUID() };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { access_token: `${PREFIX}${body}.${sign(body).toString('base64url')}`, expires_at: payload.exp };
}

export const isSiteToken = (t) => typeof t === 'string' && t.startsWith(PREFIX);

// Returns the payload, or null for anything forged, tampered with or expired.
export function verifySiteToken(token) {
  if (!isSiteToken(token) || token.length > 2048) return null;
  const [body, sig] = token.slice(PREFIX.length).split('.');
  if (!body || !sig) return null;
  const got = Buffer.from(sig, 'base64url');
  const want = sign(body);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p?.v !== 1 || typeof p.sub !== 'string' || typeof p.site !== 'string' || !(p.exp > Date.now() / 1000) || !(p.iat >= NOT_BEFORE)) return null;
  return p;
}
