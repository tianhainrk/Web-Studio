create extension if not exists pgcrypto;
create table if not exists reel_connections(provider text primary key,secret_enc text not null,updated_at timestamptz default now());
create table if not exists reel_pages(page_id text primary key,name text not null,token_enc text not null,active boolean default true,updated_at timestamptz default now());
create table if not exists reel_campaigns(id uuid primary key default gen_random_uuid(),name text not null,page_id text references reel_pages(page_id),folder_id text not null,start_at timestamptz not null,per_day integer not null,spacing_minutes integer not null,status text default 'active',created_at timestamptz default now());
create table if not exists reel_jobs(id uuid primary key default gen_random_uuid(),campaign_id uuid references reel_campaigns(id) on delete cascade,page_id text references reel_pages(page_id),folder_id text not null,file_id text not null,filename text not null,episode integer not null,caption text default '',scheduled_at timestamptz not null,status text default 'queued',meta_video_id text,meta_status jsonb,error text,updated_at timestamptz default now(),unique(page_id,file_id));
create index if not exists reel_jobs_schedule_idx on reel_jobs(status,scheduled_at);
create table if not exists reel_audit(id bigint generated always as identity primary key,action text not null,job_id uuid,details jsonb default '{}'::jsonb,created_at timestamptz default now());
alter table reel_connections enable row level security;
alter table reel_pages enable row level security;
alter table reel_campaigns enable row level security;
alter table reel_jobs enable row level security;
alter table reel_audit enable row level security;

-- Restrict access to server-side service role only.
revoke all on reel_connections,reel_pages,reel_campaigns,reel_jobs,reel_audit from anon,authenticated;
create or replace function public.claim_reel_jobs(p_limit integer default 1)
returns setof public.reel_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select j.id from public.reel_jobs j
    join public.reel_campaigns c on c.id=j.campaign_id
    join public.reel_pages p on p.page_id=j.page_id
    where j.status='queued' and j.scheduled_at<=now() and c.status='active' and p.active=true
    order by j.scheduled_at,j.id
    limit greatest(1,least(p_limit,5))
    for update of j skip locked
  ), changed as (
    update public.reel_jobs j set status='uploading',updated_at=now()
    where j.id in (select id from candidates)
    returning j.*
  ) select * from changed;
end $$;
revoke all on function public.claim_reel_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_reel_jobs(integer) to service_role;
