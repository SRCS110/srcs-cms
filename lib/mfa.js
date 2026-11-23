// Two-step sign-in (authenticator app codes) for Sync Race Studios admins, using
// Supabase Auth MFA. Called with the sign-in page's own session; the browser never
// talks to Supabase directly.
import { HttpError } from './http.js';

const base = () => `${process.env.SUPABASE_URL}/auth/v1`;
async function sb(method, path, token, body) {
  const r = await fetch(base() + path, {
    method,
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (r.status === 422 || r.status === 400) throw new HttpError(400, /invalid|code/i.test(data.msg || data.message || '') ? 'That code didn’t work. Check your authenticator app and try again.' : 'Couldn’t complete two-step sign-in. Try again.');
    if (r.status === 429) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    console.error('mfa', r.status, data.msg || data.message);
    throw new HttpError(502, 'Two-step sign-in isn’t available right now. Try again in a minute.');
  }
  return data;
}

// The assurance level (aal1 = email link only, aal2 = plus a code) of a verified token.
export function aalOf(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).aal || 'aal1'; } catch { return 'aal1'; }
}

export async function mfaStatus(token) {
  const user = await sb('GET', '/user', token);
  const factors = (user.factors || []).filter((f) => f.factor_type === 'totp');
  const verified = factors.find((f) => f.status === 'verified');
  return { enrolled: !!verified, factorId: verified?.id || null, unverified: factors.filter((f) => f.status !== 'verified').map((f) => f.id) };
}

export async function mfaEnroll(token) {
  const st = await mfaStatus(token);
  if (st.enrolled) throw new HttpError(409, 'Two-step sign-in is already set up. Enter the code from your authenticator app.');
  for (const id of st.unverified) await sb('DELETE', `/factors/${id}`, token);   // leftovers from an unfinished setup
  const f = await sb('POST', '/factors', token, { factor_type: 'totp', friendly_name: 'SRCS editor', issuer: 'SRCS Editor' });
  return { factorId: f.id, qr: qrDataUrl(f.totp?.qr_code), secret: f.totp?.secret };
}

// Supabase returns the QR as an unencoded "data:image/svg+xml;utf-8,<svg…>" URL. Its
// "#" colour codes end the URL early in browsers, so the image never renders.
// Re-encode the SVG as base64 so it displays everywhere.
export function qrDataUrl(qr) {
  if (!qr || typeof qr !== 'string') return null;
  if (/^data:image\/svg\+xml;base64,/.test(qr)) return qr;
  const i = qr.indexOf(',');
  const svg = qr.trim().startsWith('<') ? qr.trim() : (i >= 0 ? qr.slice(i + 1) : '');
  if (!/<svg[\s>]/i.test(svg)) return null;
  let text = svg;
  try { if (/%3C/i.test(svg)) text = decodeURIComponent(svg); } catch { /* keep as-is */ }
  return 'data:image/svg+xml;base64,' + Buffer.from(text, 'utf8').toString('base64');
}

// Returns a fresh Supabase session at aal2.
export async function mfaVerify(token, factorId, code) {
  if (!/^[0-9a-f-]{36}$/.test(String(factorId || ''))) throw new HttpError(400, 'Start two-step setup again.');
  if (!/^\d{6}$/.test(String(code || ''))) throw new HttpError(400, 'Enter the 6-digit code from your authenticator app.');
  const ch = await sb('POST', `/factors/${factorId}/challenge`, token, {});
  const s = await sb('POST', `/factors/${factorId}/verify`, token, { challenge_id: ch.id, code: String(code) });
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) };
}
