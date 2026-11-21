// POST { site, contentType, bytes, width, height } — a one-time URL to upload an image straight to storage.
import crypto from 'node:crypto';
import { endpoint, sendJson, HttpError } from '../lib/http.js';
import { db, requireUser, siteByKey, requireRole } from '../lib/db.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
const BUCKET = process.env.CMS_BUCKET || 'site-assets';
const MAX = 10 * 1024 * 1024;

export default endpoint({ methods: ['POST'], cors: 'sites' }, async (req, res) => {
  const user = await requireUser(req);
  const site = await siteByKey(req.body.site);
  await requireRole(site, user);
  const ext = TYPES[req.body.contentType];
  if (!ext) throw new HttpError(400, 'Use a JPG, PNG, WebP, AVIF or GIF image');
  const bytes = Number(req.body.bytes);
  if (!(bytes > 0 && bytes <= MAX)) throw new HttpError(400, 'Images must be under 10 MB');

  const month = new Date().toISOString().slice(0, 7);
  const path = `${site.id}/${month}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new HttpError(502, 'Couldn’t prepare the upload. Try again.');

  const int = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const ins = await db().from('assets').insert({
    site_id: site.id, path, content_type: req.body.contentType, bytes, width: int(req.body.width), height: int(req.body.height), uploaded_by: user.id,
  });
  if (ins.error) console.error('asset insert failed', ins.error);

  sendJson(res, 200, {
    uploadUrl: data.signedUrl,
    headers: { apikey: process.env.SUPABASE_ANON_KEY },
    publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`,
  });
});
