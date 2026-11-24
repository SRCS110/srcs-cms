# AI website assistants

A chat assistant, powered by Claude, that answers visitors' questions about a business, takes their details for follow-up and sends them to a booking page. Sold two ways:

| Plan | What it is | Managed by |
| --- | --- | --- |
| `widget` | One script tag on any website (Squarespace, Wix, WordPress, anything) | SRCS, in Supabase |
| `addon` | Added to a site SRCS built and hosts, linked to its CMS site | The client, from the editor's **Assistant** panel |

```
visitor ── agent.js ──► cms.srcs.online/api/agent ──► Claude API
                                 │
                                 ├── Supabase: agents, agent_conversations, agent_messages, agent_leads
                                 └── Resend: new-lead email to the business
```

## Embed

```html
<script src="https://cms.srcs.online/agent.js" data-agent="KEY" async></script>
```

Options: `data-target="#chat"` renders the chat inside an element instead of a floating button; `data-open` opens it on load; `data-color="#hex"` and `data-font="Jost, sans-serif"` override the look.

## Add an assistant

```sql
-- Add-on for a CMS site (domains come from the site):
insert into agents (key, name, plan, site_id, settings)
select 'topophilia', 'Topophilia Design Studio', 'addon', id,
  '{"business_name":"Topophilia Design Studio","lead_email":"owner@example.com"}'
from sites where key = 'topophilia';

-- Widget for any website:
insert into agents (key, name, plan, domains, settings)
values ('acme', 'Acme Bakery', 'widget', '{acmebakery.com,www.acmebakery.com}',
  '{"business_name":"Acme Bakery","lead_email":"orders@acmebakery.com"}');
```

Then fill in the knowledge (the client can do this from **Assistant** in the editor for add-ons). Settings: `assistant_name`, `business_name`, `greeting`, `suggestions[]`, `about`, `knowledge`, `faqs[{q,a}]`, `instructions`, `booking_url`, `booking_label`, `contact_phone`, `lead_email`, `collect_leads`, `color`, `position`, `launcher_label`, `privacy_url`.

Per-agent columns only SRCS changes: `domains`, `model` (default `AGENT_MODEL`), `monthly_message_cap` (default 3,000 visitor messages), `active`.

## Environment (srcs-cms on Vercel)

| Variable | Value | Secret |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key, from a workspace used only for assistants, with a monthly spend limit | **yes** |
| `RESEND_API_KEY` | Same Resend key as srcs.online, for lead and alert emails | **yes** |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile widget for the human check. Add every assistant domain to its hostnames, or set `challenge=false` on that agent | secret key **yes** |
| `AGENT_DISABLED` | `1` switches every assistant off at once | no |
| `AGENT_LIMIT_GLOBAL_DAY` | Visitor messages per 24 h across all assistants. Default 2000 | no |
| `AGENT_LIMIT_IP_HOUR` / `AGENT_LIMIT_IP_DAY` | Per visitor. Defaults 20 / 60 | no |
| `AGENT_LIMIT_CONVERSATION` | Visitor messages per chat. Default 30 | no |
| `AGENT_LIMIT_LEAD_EMAILS_DAY` | Lead emails per assistant per 24 h. Default 30 | no |
| `AGENT_MODEL` / `AGENT_ALLOWED_MODELS` | Default and allow-list. Default `claude-haiku-5-5` only | no |
| `AGENT_ALERT_EMAIL` | Where limit alerts go. Default `admin@srcs.online` | no |
| `AGENT_FROM` | Sender. Default `Website assistant <hello@srcs.online>` | no |

Per agent (Supabase `agents`): `monthly_message_cap` (default 3000), `daily_message_cap` (300), `challenge` (true), `active`.

## Billing AI usage

Clients pay $99/month plus AI usage at cost. Each reply stores its token counts. For invoices: `select * from agent_usage_monthly order by month desc, key;` (Supabase SQL editor). Clients see this month's figure in the editor's **Assistant** panel. Prices are Haiku 5.5 list rates; change `AGENT_PRICE_*` env vars and the view if the model or prices change.

## Cost and abuse controls

Each request is bounded: business info capped at 40,000 characters (about 10K tokens, far below Haiku 5.5's 100K higher-price tier), chat history at 12 turns / 8,000 characters, visitor messages at 1,000 characters, replies at 400 tokens, at most 3 model calls per message. Only allow-listed models run.

Volume is bounded in layers, checked before any AI call: Turnstile human check per chat (when keys are set) → per visitor IP (20/hour, 60/day) → per chat (30) → per assistant per day (300) and month (3,000) → all assistants per day (2,000) → `AGENT_DISABLED`. Limits that trip email SRCS once a day.

The hard backstop is outside this code: set a monthly spend limit on the Anthropic workspace that owns `ANTHROPIC_API_KEY`.

Other protections: the widget's origin check stops other websites' visitors from using an assistant in a browser (scripts can fake origins, so the limits above are what count); a chat is tied to the IP that started it; the assistant can't see leads, emails or other chats, so prompt injection can only reach the business info, which is public anyway (tell clients not to put anything private in it); one lead per chat, 3 per IP per day, 30 emails per assistant per day; all text in the widget, editor and lead emails is escaped; only https, mailto and tel links are allowed.

Chats are kept 90 days (`select agent_prune();`; schedule it with pg_cron if wanted). Leads are kept until deleted. Mention the assistant in the client's privacy policy.
