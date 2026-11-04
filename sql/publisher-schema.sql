-- Execute once in the Supabase SQL editor for a dedicated project.
-- Access only through the server-side service-role credential.
create extension if not exists pgcrypto;

create table if not exists public.publisher_credentials (
  id text primary key,
  provider text not null check (provider in ('google-drive','meta-page','meta-user')),
  display_name text not null,
  ciphertext text not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.publisher_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  ai_provider text not null check (ai_provider in ('gemini','muse')),
  tone text not null default 'natural',
  config jsonb not null,
  status text not null default 'draft'
    check (status in ('draft','approved','paused','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.publisher_posts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.publisher_campaigns(id) on delete cascade,
  page_id text not null,
  series_id text not null,
  movie_title text not null default '',
  episode_number integer not null check (episode_number between 1 and 5000),
  episode_description text not null default '',
  genres text not null default '',
  drive_file_id text not null,
  scheduled_at timestamptz not null,
  local_date text not null,
  local_time text not null,
  title text not null default '',
  caption text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  rights_approved boolean not null default false,
  editorial_approved boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','awaiting_rights','approved','initializing','uploading',
      'transferring','finalizing','scheduled','published','failed','needs_reconcile','cancelled')),
  upload_session_id text,
  meta_video_id text,
  file_size bigint,
  start_offset bigint not null default 0,
  end_offset bigint,
  lock_token text,
  meta_response jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publisher_unique_file unique (campaign_id,page_id,drive_file_id),
  constraint publisher_unique_episode unique (campaign_id,page_id,series_id,episode_number)
);

create index if not exists publisher_posts_campaign_time_idx
  on public.publisher_posts(campaign_id,scheduled_at);
-- Prevent accidental duplicate scheduling of the same Drive file on the same Page,
-- including across separate campaigns. Cancelled drafts/schedules are exempt.
create unique index if not exists publisher_no_duplicate_active_file
  on public.publisher_posts(page_id,drive_file_id)
  where status <> 'cancelled';

create index if not exists publisher_posts_status_idx
  on public.publisher_posts(status,scheduled_at);

create table if not exists public.publisher_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.publisher_campaigns(id) on delete cascade,
  post_id uuid references public.publisher_posts(id) on delete cascade,
  event_name text not null check (char_length(event_name) between 2 and 80),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists publisher_events_campaign_idx
  on public.publisher_events(campaign_id,created_at desc);

alter table public.publisher_credentials enable row level security;
alter table public.publisher_campaigns enable row level security;
alter table public.publisher_posts enable row level security;
alter table public.publisher_events enable row level security;

-- No anon/authenticated policies: only server-side service role may access.
revoke all on public.publisher_credentials from anon,authenticated;
revoke all on public.publisher_campaigns from anon,authenticated;
revoke all on public.publisher_posts from anon,authenticated;
revoke all on public.publisher_events from anon,authenticated;
revoke all on sequence public.publisher_events_id_seq from anon,authenticated;
