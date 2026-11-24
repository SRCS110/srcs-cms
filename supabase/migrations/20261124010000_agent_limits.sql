-- Cost and abuse limits for AI assistants.
alter table public.agents
  add column if not exists daily_message_cap integer not null default 300 check (daily_message_cap >= 0),
  add column if not exists challenge boolean not null default true;
comment on column public.agents.challenge is 'Require a Cloudflare Turnstile check before a chat starts (when TURNSTILE_* keys are set). The agent''s domains must be added to the Turnstile widget''s hostnames.';

alter table public.agent_leads add column if not exists ip_hash text;
create index if not exists agent_leads_ip_created_idx on public.agent_leads (ip_hash, created_at desc);
create index if not exists agent_messages_role_created_idx on public.agent_messages (role, created_at desc);

-- One alert email per kind, per agent, per day.
create table if not exists public.agent_alerts (
  id bigint generated always as identity primary key,
  agent_id uuid references public.agents (id) on delete cascade,
  kind text not null,
  day date not null,
  created_at timestamptz not null default now()
);
create unique index if not exists agent_alerts_once_idx on public.agent_alerts (coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, day);
create index if not exists agent_alerts_agent_idx on public.agent_alerts (agent_id);
alter table public.agent_alerts enable row level security;
revoke all on public.agent_alerts from anon, authenticated;
