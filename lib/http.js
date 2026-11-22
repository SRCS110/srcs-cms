// Request plumbing shared by every endpoint: CORS limited to registered client domains,
// method checks, JSON responses and errors that never leak internals.
export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

let originCache = { at: 0, set: new Set() };

async function allowedOrigins(loadDomains) {
  if (Date.now() - originCache.at < 60_000) return originCache.set;
  const set = new Set();
  const cms = process.env.CMS_ORIGIN || 'https://cms.srcs.online';
  set.add(cms);
  try {
    for (const d of await loadDomains()) {
      const host = String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!host) continue;
      set.add(`https://${host}`);
      if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) set.add(`http://${host}`);
    }
  } catch (e) {
    console.error('origin lookup failed', e);
  }
  originCache = { at: Date.now(), set };
  return set;
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify(body));
}

/**
 * Wraps an endpoint.
 * opts.methods: allowed methods. opts.cors: 'sites' (client domains) | 'cms' (cms origin only).
 */
export function endpoint(opts, fn) {
  const methods = opts.methods || ['GET'];
  return async (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      const { loadAllDomains } = await import('./db.js');
      const allowed = opts.cors === 'cms'
        ? new Set([process.env.CMS_ORIGIN || 'https://cms.srcs.online'])
        : await allowedOrigins(loadAllDomains);
      let sameHost = false;
      try { sameHost = new URL(origin).host === req.headers.host; } catch {}
      if (sameHost || allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
        res.setHeader('Access-Control-Max-Age', '600');
      } else if (req.method !== 'OPTIONS') {
        return sendJson(res, 403, { error: 'This domain is not registered with the CMS' });
      }
    }
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (!methods.includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed' });
    try {
      if (req.method !== 'GET' && typeof req.body === 'string') {
        try { req.body = JSON.parse(req.body || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); }
      }
      req.body = req.body || {};
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status >= 500) console.error(err.message, err.github || '');
        return sendJson(res, err.status, { error: err.message, ...(err.extra || {}) });
      }
      console.error(err);
      // Content validation errors from apply/sanitize are safe to show.
      if (err && err.name === 'ContentError') return sendJson(res, 422, { error: err.message });
      return sendJson(res, 500, { error: 'Something went wrong. Try again, or contact Sync Race Studios.' });
    }
  };
}

export function requireString(v, name, max = 500) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, `Missing or invalid ${name}`);
  return v.trim();
}
