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
| `ANTHROPIC_API_KEY` | Claude API key from console.anthropic.com | **yes** |
| `RESEND_API_KEY` | Same Resend key as srcs.online, for lead emails | **yes** |
| `AGENT_MODEL` | Optional. Default `claude-haiku-5-5` | no |
| `AGENT_FROM` | Optional. Default `Website assistant <hello@srcs.online>` | no |
| `AGENT_LIMIT_IP_HOUR` / `AGENT_LIMIT_CONVERSATION` | Optional. Defaults 40 / 40 | no |

## Safety and limits

- The widget only works on the agent's domains (and its linked site's). Calls from anywhere else get 403.
- Visitor messages: 1,500 characters max, 40 per hour per visitor, 40 per chat, plus the monthly cap per agent.
- The assistant answers only from the business's own information, says it's an AI, never asks for payment or ID details, and only sends a lead after the visitor gives an email or phone and agrees.
- Chats are kept 90 days (`select agent_prune();` removes older ones; schedule it with pg_cron if wanted). Leads are kept until deleted. Mention the assistant in the client's privacy policy.
