-- SRCS inline CMS: core tables.
-- Only the Edit API (service role) reads or writes these. RLS is on with no
-- policies, so the public/anon key can't touch them.

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  domains text[] not null default '{}',
  repo_owner text not null,
  repo_name text not null,
  branch text not null default 'main',
  root text not null default '',
  mode text not null default 'html' check (mode in ('html', 'content-json')),
  installation_id bigint,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.sites is 'Client sites editable through the CMS. domains: hostnames allowed to call the API and to receive sign-in redirects.';

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.admins is 'Sync Race Studios staff: can edit every site and add owners.';

create table if not exists public.site_users (
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'editor')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (site_id, user_id)
);
create index if not exists site_users_user_idx on public.site_users (user_id);

create table if not exists public.edits (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  editor_email text,
  kind text not null default 'edit' check (kind in ('edit', 'revert')),
  page_path text,
  files text[] not null default '{}',
  regions text[] not null default '{}',
  commit_sha text,
  reverts bigint references public.edits (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists edits_site_created_idx on public.edits (site_id, created_at desc);
create index if not exists edits_user_created_idx on public.edits (user_id, created_at desc);
create index if not exists edits_reverts_idx on public.edits (reverts);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  path text not null unique,
  content_type text,
  bytes integer,
  width integer,
  height integer,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists assets_site_idx on public.assets (site_id);
create index if not exists assets_uploaded_by_idx on public.assets (uploaded_by);
create index if not exists site_users_invited_by_idx on public.site_users (invited_by);

alter table public.sites enable row level security;
alter table public.admins enable row level security;
alter table public.site_users enable row level security;
alter table public.edits enable row level security;
alter table public.assets enable row level security;

revoke all on public.sites, public.admins, public.site_users, public.edits, public.assets from anon, authenticated;

-- Public image bucket. Uploads only through signed URLs the API issues.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets', 'site-assets', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
