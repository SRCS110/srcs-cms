// AI agents.
// Public (called by agent.js on a website, CORS limited to the agent's domains):
//   GET  ?op=config&agent=           widget settings
//   POST ?op=chat&agent=  { conversation?, visitor?, message, page? }
// Editor (site pass from the CMS, for the site the agent is linked to):
//   GET  ?op=settings&site=   · PATCH ?op=settings&site= { settings }
//   GET  ?op=leads&site=      · DELETE ?op=leads&site= { id }
import { endpoint, sendJson, HttpError } from '../http.js';
import { db, requireUser, siteByKey, requireRole } from '../db.js';
import {
  LIMITS, agentByKey, agentForSite, agentOrigins, publicConfig, cleanSettings, runTurn,
  cleanLead, notifyLead, ipHash, checkLimits, monthStart,
} from '../agent.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CMS = () => process.env.CMS_ORIGIN || 'https://cms.srcs.online';

// ---------------------------------------------------------------- editor
const editor = endpoint({ methods: ['GET', 'PATCH', 'DELETE'], cors: 'sites' }, async (req, res) => {
  const site = await siteByKey(req.query.site);
  const user = await requireUser(req, site);
  const role = await requireRole(site, user);
  const agent = await agentForSite(site.id);
  if (!agent) throw new HttpError(404, 'This site doesn’t have an assistant yet. Contact Sync Race Studios to add one.');

  if (req.query.op === 'leads') {
    if (req.method === 'DELETE') {
      const id = String(req.body.id || '');
      if (!UUID.test(id)) throw new HttpError(400, 'Invalid lead');
      const { error } = await db().from('agent_leads').delete().eq('id', id).eq('agent_id', agent.id);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    const { data, error } = await db().from('agent_leads').select('id, name, email, phone, message, page_url, notified, created_at')
      .eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return sendJson(res, 200, { leads: data });
  }

  if (req.method === 'PATCH') {
    const settings = cleanSettings(req.body.settings || {});
    const { error } = await db().from('agents').update({ settings, updated_at: new Date().toISOString() }).eq('id', agent.id);
    if (error) throw error;
    agent.settings = settings;
  } else if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

  const used = await db().from('agent_messages').select('id', { count: 'exact', head: true }).eq('agent_id', agent.id).eq('role', 'user').gte('created_at', monthStart());
  if (used.error) throw used.error;
  sendJson(res, 200, {
    agent: { key: agent.key, name: agent.name, plan: agent.plan, active: agent.active, settings: cleanSettings(agent.settings || {}) },
    usage: { messages: used.count, cap: agent.monthly_message_cap },
    embed: `<script src="${CMS()}/agent.js" data-agent="${agent.key}" async></script>`,
    role,
  });
});

// ---------------------------------------------------------------- public
function cors(req, res, agent, methods) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (!agentOrigins(agent).has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function history(rows) {
  // Alternate user/assistant, start with the visitor, keep the most recent turns.
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.role === r.role) last.content += `\n\n${r.content}`;
    else out.push({ role: r.role, content: r.content });
  }
  let trimmed = out.slice(-LIMITS.historyTurns);
  while (trimmed.length && trimmed[0].role !== 'user') trimmed = trimmed.slice(1);
  return trimmed;
}

async function chat(req, res, agent) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { throw new HttpError(400, 'Invalid JSON'); } }
  body = body || {};
  const message = typeof body.message === 'string' ? body.message.replace(/\u0000/g, '').trim() : '';
  if (!message) throw new HttpError(400, 'Type a message first');
  if (message.length > LIMITS.messageChars) throw new HttpError(400, 'That message is a bit long. Could you shorten it?');
  const page = { url: String(body.page?.url || '').slice(0, 500), title: String(body.page?.title || '').slice(0, 200) };
  const visitor = /^[a-z0-9-]{8,64}$/i.test(String(body.visitor || '')) ? String(body.visitor) : null;
  const ip = ipHash(req);
  await checkLimits(agent, ip);

  let convo = null;
  if (UUID.test(String(body.conversation || ''))) {
    const { data, error } = await db().from('agent_conversations').select('*').eq('id', body.conversation).eq('agent_id', agent.id).maybeSingle();
    if (error) throw error;
    convo = data;
  }
  if (!convo) {
    const { data, error } = await db().from('agent_conversations').insert({ agent_id: agent.id, visitor, ip_hash: ip, page_url: page.url || null }).select('*').single();
    if (error) throw error;
    convo = data;
  }
  if (convo.message_count >= LIMITS.perConversation * 2) throw new HttpError(429, 'This chat has reached its limit. Refresh the page to start a new one, or use the contact details on this website.');

  const { data: past, error: pErr } = await db().from('agent_messages').select('role, content').eq('conversation_id', convo.id).order('id', { ascending: false }).limit(LIMITS.historyTurns * 2);
  if (pErr) throw pErr;
  const ins = await db().from('agent_messages').insert({ conversation_id: convo.id, agent_id: agent.id, role: 'user', content: message, ip_hash: ip });
  if (ins.error) throw ins.error;
  const turns = history([...past.reverse(), { role: 'user', content: message }]);

  let leadSaved = false;
  const result = await runTurn(agent, turns, page, {
    async capture_lead(input) {
      if (leadSaved) return 'Already sent to the team.';
      const lead = cleanLead(input);
      const { data: row, error } = await db().from('agent_leads').insert({ agent_id: agent.id, conversation_id: convo.id, ...lead, page_url: page.url || null }).select('id').single();
      if (error) throw error;
      leadSaved = true;
      await db().from('agent_conversations').update({ lead_id: row.id }).eq('id', convo.id);
      const sent = await notifyLead(agent, { ...lead, page_url: page.url }, turns);
      if (sent) await db().from('agent_leads').update({ notified: true }).eq('id', row.id);
      return 'Saved and sent to the team. Tell the visitor the team will be in touch soon. Do not promise a specific time.';
    },
    async show_booking() { return 'A booking button is now shown under your message.'; },
  });

  await db().from('agent_messages').insert({ conversation_id: convo.id, agent_id: agent.id, role: 'assistant', content: result.text, input_tokens: result.usage.input, output_tokens: result.usage.output });
  await db().from('agent_conversations').update({ message_count: convo.message_count + 2, updated_at: new Date().toISOString() }).eq('id', convo.id);

  const s = agent.settings || {};
  return sendJson(res, 200, {
    conversation: convo.id,
    reply: result.text,
    booking: result.booking && s.booking_url ? { url: s.booking_url, label: s.booking_label || 'Book now' } : null,
    lead: result.lead,
  });
}

async function publicApi(req, res) {
  try {
    const agent = await agentByKey(req.query.agent);
    const op = req.query.op;
    const methods = op === 'chat' ? ['POST'] : ['GET'];
    if (!cors(req, res, agent, methods)) return sendJson(res, 403, { error: 'This assistant isn’t set up for this website' });
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (!methods.includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed' });
    if (op === 'config') return sendJson(res, 200, publicConfig(agent));
    return await chat(req, res, agent);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    return sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}

export default async function handler(req, res) {
  const op = req.query.op;
  if (op === 'config' || op === 'chat') return publicApi(req, res);
  if (op === 'settings' || op === 'leads') return editor(req, res);
  return sendJson(res, 404, { error: 'Not found' });
}
