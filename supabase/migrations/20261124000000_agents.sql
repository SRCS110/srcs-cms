-- SRCS AI agents: chat agents embedded on client websites.
-- An agent can stand alone (the widget on any website) or be linked to a CMS site
-- (the add-on), in which case the site's owners and editors manage it from the editor.
-- Only the API (service role) reads or writes these. RLS on, no policies.

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  site_id uuid references public.sites (id) on delete set null,
  name text not null,
  plan text not null default 'widget' check (plan in ('widget', 'addon')),
  domains text[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  model text,
  monthly_message_cap integer not null default 3000 check (monthly_message_cap >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.agents is 'AI chat agents. domains: hostnames allowed to load the widget (a linked site''s domains are allowed too). settings: business-editable greeting, knowledge, FAQs, booking link, lead email and colours.';
create index if not exists agents_site_idx on public.agents (site_id);

create table if not exists public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  visitor text,
  ip_hash text,
  page_url text,
  message_count integer not null default 0,
  lead_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_conversations_agent_idx on public.agent_conversations (agent_id, created_at desc);

create table if not exists public.agent_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.agent_conversations (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  ip_hash text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists agent_messages_conv_idx on public.agent_messages (conversation_id, id);
create index if not exists agent_messages_agent_created_idx on public.agent_messages (agent_id, created_at desc);
create index if not exists agent_messages_ip_created_idx on public.agent_messages (ip_hash, created_at desc);

create table if not exists public.agent_leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  conversation_id uuid references public.agent_conversations (id) on delete set null,
  name text,
  email text,
  phone text,
  message text,
  page_url text,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists agent_leads_agent_created_idx on public.agent_leads (agent_id, created_at desc);
create index if not exists agent_leads_conv_idx on public.agent_leads (conversation_id);

alter table public.agent_conversations
  add constraint agent_conversations_lead_fk foreign key (lead_id) references public.agent_leads (id) on delete set null;
create index if not exists agent_conversations_lead_idx on public.agent_conversations (lead_id);

alter table public.agents enable row level security;
alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_leads enable row level security;

revoke all on public.agents, public.agent_conversations, public.agent_messages, public.agent_leads from anon, authenticated;

-- Chat history is kept 90 days. Leads are kept until deleted.
create or replace function public.agent_prune() returns void language sql security definer set search_path = public as $$
  delete from public.agent_conversations where updated_at < now() - interval '90 days';
$$;
revoke all on function public.agent_prune() from public, anon, authenticated;
