import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.CMS_SESSION_SECRET = 'test-secret-for-unit-tests';
const { mintSiteToken, verifySiteToken } = await import('../lib/session.js');
const { requireUser } = await import('../lib/db.js');

const req = (t) => ({ headers: { authorization: 'Bearer ' + t } });
const siteA = { key: 'alpha' }, siteB = { key: 'beta' };
const user = { id: '11111111-1111-1111-1111-111111111111', email: 'e@x.co' };

test('a site pass works only for its own site', async () => {
  const { access_token } = mintSiteToken(user, siteA);
  assert.equal((await requireUser(req(access_token), siteA)).id, user.id);
  await assert.rejects(requireUser(req(access_token), siteB), /different site/);
});

test('tampered, forged and expired passes are refused', async () => {
  const { access_token } = mintSiteToken(user, siteA);
  const [pre, body, sig] = [access_token.slice(0, 6), ...access_token.slice(6).split('.')];
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  const swapped = pre + Buffer.from(JSON.stringify({ ...p, site: 'beta' })).toString('base64url') + '.' + sig;
  assert.equal(verifySiteToken(swapped), null);
  assert.equal(verifySiteToken(access_token.slice(0, -2) + 'AA'), null);
  const expired = pre + Buffer.from(JSON.stringify({ ...p, exp: 1 })).toString('base64url') + '.' + sig;
  assert.equal(verifySiteToken(expired), null);
  await assert.rejects(requireUser(req(swapped), siteB), /expired/);
});

test('full Supabase sessions are refused by site endpoints', async () => {
  await assert.rejects(requireUser(req('eyJhbGciOiJIUzI1NiJ9.x.y'), siteA), /sign in again/);
  await assert.rejects(requireUser({ headers: {} }, siteA), /sign in/i);
});
