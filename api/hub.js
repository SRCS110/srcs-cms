// Several small endpoints share this one function (the Vercel Hobby plan allows 12 per deployment).
// vercel.json rewrites /api/health, /api/whoami and /api/agent here with ?route=.
import health from '../lib/routes/health.js';
import whoami from '../lib/routes/whoami.js';
import agent from '../lib/routes/agent.js';
import { sendJson } from '../lib/http.js';

const ROUTES = { health, whoami, agent };

export default function handler(req, res) {
  const fn = ROUTES[req.query.route];
  if (!fn) return sendJson(res, 404, { error: 'Not found' });
  return fn(req, res);
}
