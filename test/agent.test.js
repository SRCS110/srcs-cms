import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, publicConfig, systemPrompt, tools, runTurn, cleanLead, agentOrigins } from '../lib/agent.js';

const agent = {
  key: 'demo', name: 'Demo Co', model: null,
  domains: ['demo.com'], site: { active: true, domains: ['www.demo.com'] },
  settings: cleanSettings({ business_name: 'Demo Co', knowledge: 'Open 9 to 5.', booking_url: 'https://cal.com/demo', lead_email: 'owner@demo.com', faqs: [{ q: 'Parking?', a: 'Free lot.' }, { q: '', a: 'dropped' }] }),
};

test('cleanSettings trims, validates and drops empty FAQs', () => {
  assert.equal(agent.settings.faqs.length, 1);
  assert.throws(() => cleanSettings({ booking_url: 'javascript:alert(1)' }));
  assert.throws(() => cleanSettings({ lead_email: 'nope' }));
  assert.equal(cleanSettings({ color: 'red' }).color, '');
  assert.equal(cleanSettings({ knowledge: 'x'.repeat(30000) }).knowledge.length, 20000);
});

test('publicConfig never exposes knowledge or lead email', () => {
  const c = JSON.stringify(publicConfig(agent));
  assert.ok(!c.includes('Open 9 to 5'));
  assert.ok(!c.includes('owner@demo.com'));
  assert.ok(c.includes('cal.com/demo'));
});

test('prompt carries the business info and tools follow settings', () => {
  const sys = systemPrompt(agent, { url: 'https://demo.com/x', title: 'X' });
  assert.ok(sys[0].text.includes('Open 9 to 5.') && sys[0].text.includes('Parking?'));
  assert.deepEqual(tools(agent).map((t) => t.name), ['capture_lead', 'show_booking']);
  const quiet = { ...agent, settings: { ...agent.settings, collect_leads: false, booking_url: '' } };
  assert.deepEqual(tools(quiet), []);
});

test('origins include agent and linked site domains', () => {
  const o = agentOrigins(agent);
  assert.ok(o.has('https://demo.com') && o.has('https://www.demo.com') && !o.has('https://evil.com'));
});

test('cleanLead needs a way to reply', () => {
  assert.throws(() => cleanLead({ message: 'hi' }));
  assert.throws(() => cleanLead({ email: 'bad', message: 'hi' }));
  assert.equal(cleanLead({ email: 'A@B.co', message: 'hi' }).email, 'a@b.co');
});

test('runTurn runs tools and returns the final text', async () => {
  const calls = [];
  const fake = async (req) => {
    calls.push(req);
    if (calls.length === 1) return { stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [
      { type: 'text', text: 'Let me pass that on.' },
      { type: 'tool_use', id: 't1', name: 'capture_lead', input: { email: 'v@x.com', message: 'Quote' } },
      { type: 'tool_use', id: 't2', name: 'show_booking', input: {} }] };
    return { stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 6 }, content: [{ type: 'text', text: 'Done! The team will be in touch.' }] };
  };
  let lead;
  const out = await runTurn(agent, [{ role: 'user', content: 'Can I get a quote? v@x.com' }], null, {
    capture_lead: async (i) => { lead = i; return 'Saved'; }, show_booking: async () => 'Shown',
  }, fake);
  assert.equal(lead.email, 'v@x.com');
  assert.ok(out.lead && out.booking);
  assert.equal(out.text, 'Let me pass that on.\n\nDone! The team will be in touch.');
  assert.equal(calls[1].messages.at(-1).content[0].type, 'tool_result');
  assert.equal(out.usage.input, 22);
});
