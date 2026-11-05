-- Run once in the existing Anpi Drama Supabase project, SQL Editor.
-- Requires supabase/reels.sql to have been applied first.
create table if not exists public.reel_ai_batches (
  id uuid primary key default gen_random_uuid(),
  folder_id text not null,
  title text not null,
  instructions text not null default '',
  total integer not null check (total between 1 and 300),
  status text not null default 'queued' check (status in ('queued','running','completed','partial','cancelled')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.reel_ai_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.reel_ai_batches(id) on delete cascade,
  episode integer not null check (episode between 1 and 5000),
  file_id text not null,
  filename text not null,
  scheduled_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','running','ready','failed')),
  caption text,
  summary text,
  error text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(batch_id, episode)
);
create index if not exists reel_ai_items_queue_idx on public.reel_ai_items(status,updated_at);
create index if not exists reel_ai_items_batch_idx on public.reel_ai_items(batch_id,episode);
alter table public.reel_ai_batches enable row level security;
alter table public.reel_ai_items enable row level security;
revoke all on public.reel_ai_batches,public.reel_ai_items from anon,authenticated;
-- Only server-side service_role can claim due jobs. Stale claims are retried
-- up to three times after 35 minutes (e.g. interrupted GitHub Actions jobs).
create or replace function public.claim_reel_ai_item()
returns setof public.reel_ai_items
language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidate as (
    select i.id from public.reel_ai_items i
    join public.reel_ai_batches b on b.id=i.batch_id
    where b.status in ('queued','running','partial')
      and i.attempts < 3
      and (i.status='queued' or (i.status='running' and i.updated_at < now()-interval '35 minutes'))
    order by b.created_at,i.episode
    limit 1
    for update of i skip locked
  ), claimed as (
    update public.reel_ai_items i
      set status='running',attempts=attempts+1,error=null,updated_at=now()
      where i.id in (select id from candidate)
      returning i.*
  ) select * from claimed;
end $$;
revoke all on function public.claim_reel_ai_item() from public,anon,authenticated;
grant execute on function public.claim_reel_ai_item() to service_role;
