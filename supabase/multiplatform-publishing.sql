-- Anpi Studio: additive YouTube Shorts & TikTok publishing v1.
-- Existing Facebook tables and workers remain unchanged.
create table if not exists public.multi_publish_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('youtube','tiktok')),
  external_id text not null,
  display_name text not null,
  secret_enc text not null,
  scopes text not null default '',
  active boolean not null default true,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,external_id)
);
create table if not exists public.multi_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.multi_publish_accounts(id) on delete restrict,
  provider text not null check(provider in ('youtube','tiktok')),
  folder_id text not null,
  file_id text not null,
  filename text not null,
  caption text not null default '',
  title text not null default '',
  scheduled_at timestamptz not null,
  privacy text not null default 'private',
  source_url text,
  consent_recorded_at timestamptz not null,
  rights_confirmed_at timestamptz not null,
  status text not null default 'queued' check(status in
    ('queued','uploading','processing','published','uploaded_private','failed','needs_review','cancelled')),
  remote_id text,
  remote_status jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0 check(attempts >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(account_id,file_id,scheduled_at)
);
create index if not exists multi_jobs_ready_idx
 on public.multi_publish_jobs(status,scheduled_at) where status='queued';
create index if not exists multi_jobs_processing_idx
 on public.multi_publish_jobs(status,updated_at) where status='processing';
create index if not exists multi_jobs_account_idx
 on public.multi_publish_jobs(account_id,scheduled_at desc);
alter table public.multi_publish_accounts enable row level security;
alter table public.multi_publish_jobs enable row level security;
revoke all on public.multi_publish_accounts,public.multi_publish_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.multi_publish_accounts,public.multi_publish_jobs to service_role;
-- Server-side claim, only service_role can call. SKIP LOCKED prevents double claims.
create or replace function public.claim_multi_publish_jobs(p_limit integer default 1)
returns setof public.multi_publish_jobs
language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidates as (
    select j.id from public.multi_publish_jobs j
    join public.multi_publish_accounts a on a.id=j.account_id
    where j.status='queued' and j.scheduled_at<=now() and a.active
    order by j.scheduled_at,j.id
    limit greatest(1,least(p_limit,3))
    for update of j skip locked
  ), claimed as (
    update public.multi_publish_jobs j
    set status='uploading',claimed_at=now(),updated_at=now(),attempts=j.attempts+1
    where j.id in (select id from candidates)
    returning j.*
  )
  select * from claimed;
end $$;
revoke all on function public.claim_multi_publish_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_multi_publish_jobs(integer) to service_role;
