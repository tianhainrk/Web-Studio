-- Reels Analytics v1. Additive migration; existing posting/Drive tables unchanged.
-- Apply once in the *same Supabase project* used by Anpi Drama.
create extension if not exists pgcrypto;
create table if not exists public.reel_analytics_posts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.reel_jobs(id) on delete set null,
  page_id text not null references public.reel_pages(page_id) on delete cascade,
  meta_video_id text not null,
  meta_post_id text,
  permalink_url text,
  title text,
  episode integer,
  campaign_id uuid references public.reel_campaigns(id) on delete set null,
  published_at timestamptz,
  source text not null default 'anpi',
  updated_at timestamptz not null default now(),
  unique(page_id,meta_video_id)
);
create index if not exists reel_analytics_posts_page_date on public.reel_analytics_posts(page_id,published_at desc);
create table if not exists public.reel_analytics_snapshots (
  id bigint generated always as identity primary key,
  page_id text not null references public.reel_pages(page_id) on delete cascade,
  meta_video_id text not null,
  sampled_at timestamptz not null,
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  metric_values jsonb not null default '{}'::jsonb,
  metric_availability jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(page_id,meta_video_id,sampled_at)
);
create index if not exists reel_analytics_snapshots_lookup on public.reel_analytics_snapshots(page_id,meta_video_id,sampled_at desc);
create table if not exists public.reel_analytics_page_daily (
  page_id text not null references public.reel_pages(page_id) on delete cascade,
  metric_date date not null,
  media_views bigint check (media_views >= 0),
  engagements bigint check (engagements >= 0),
  follows bigint check (follows >= 0),
  metric_values jsonb not null default '{}'::jsonb,
  metric_availability jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  primary key(page_id,metric_date)
);
create index if not exists reel_analytics_page_daily_date on public.reel_analytics_page_daily(metric_date desc,page_id);
create table if not exists public.reel_analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  page_id text references public.reel_pages(page_id) on delete set null,
  status text not null default 'running' check(status in ('running','success','partial','failed')),
  triggered_by text not null default 'schedule',
  processed integer not null default 0,
  failed integer not null default 0,
  metric_status jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists reel_analytics_sync_runs_lookup on public.reel_analytics_sync_runs(page_id,started_at desc);
create table if not exists public.reel_analytics_sync_requests (
  id uuid primary key default gen_random_uuid(),
  page_id text references public.reel_pages(page_id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','completed','failed')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error text
);
create index if not exists reel_analytics_sync_requests_pending on public.reel_analytics_sync_requests(status,requested_at);
alter table public.reel_analytics_posts enable row level security;
alter table public.reel_analytics_snapshots enable row level security;
alter table public.reel_analytics_page_daily enable row level security;
alter table public.reel_analytics_sync_runs enable row level security;
alter table public.reel_analytics_sync_requests enable row level security;
revoke all on public.reel_analytics_posts,public.reel_analytics_snapshots,
  public.reel_analytics_page_daily,public.reel_analytics_sync_runs,
  public.reel_analytics_sync_requests from anon,authenticated;
-- Explicit service-role rights in environments with custom default privileges.
grant select,insert,update,delete on public.reel_analytics_posts,public.reel_analytics_snapshots,
  public.reel_analytics_page_daily,public.reel_analytics_sync_runs,
  public.reel_analytics_sync_requests to service_role;
grant usage,select on all sequences in schema public to service_role;

-- Prevent two workers from picking the same request.
create or replace function public.claim_reel_analytics_requests(p_limit integer default 3)
returns setof public.reel_analytics_sync_requests
language plpgsql security definer set search_path=public as $$
begin
  return query
  with target as (
    select r.id from public.reel_analytics_sync_requests r
    where r.status='queued' or (r.status='running' and r.updated_at < now()-interval '35 minutes')
    order by r.requested_at
    limit greatest(1,least(p_limit,5))
    for update of r skip locked
  ), result as (
    update public.reel_analytics_sync_requests r
    set status='running',updated_at=now(),error=null
    where r.id in (select id from target)
    returning r.*
  )
  select * from result;
end $$;
revoke all on function public.claim_reel_analytics_requests(integer) from public,anon,authenticated;
grant execute on function public.claim_reel_analytics_requests(integer) to service_role;
