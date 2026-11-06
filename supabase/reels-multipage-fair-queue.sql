-- Apply ONCE in the existing Anpi Drama Supabase project using SQL Editor.
-- Replaces the original claim_reel_jobs function (same signature and permissions).
-- If two or more Fanpages have overdue jobs, prioritize one due job from each
-- before taking another from a Page with a large historical backlog.
-- Atomic FOR UPDATE SKIP LOCKED still prevents duplicate claims across workers.
create or replace function public.claim_reel_jobs(p_limit integer default 1)
returns setof public.reel_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  with activity as (
    select j.page_id, max(j.updated_at) as last_processed
    from public.reel_jobs j
    where j.status in ('uploading','processing','published','failed')
    group by j.page_id
  ), eligible as (
    select j.id,j.page_id,j.scheduled_at,a.last_processed,
      row_number() over (partition by j.page_id order by j.scheduled_at,j.id) as page_position
    from public.reel_jobs j
    join public.reel_campaigns c on c.id=j.campaign_id
    join public.reel_pages p on p.page_id=j.page_id
    left join activity a on a.page_id=j.page_id
    where j.status='queued' and j.scheduled_at<=now()
      and c.status='active' and p.active=true
  ), chosen as (
    select j.id from public.reel_jobs j
    join eligible e on e.id=j.id
    where j.status='queued'
    order by e.page_position,e.last_processed nulls first,e.scheduled_at,e.id
    limit greatest(1,least(p_limit,5))
    for update of j skip locked
  ), claimed as (
    update public.reel_jobs j
      set status='uploading',updated_at=now()
    where j.id in (select id from chosen)
    returning j.*
  )
  select * from claimed;
end $$;
revoke all on function public.claim_reel_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_reel_jobs(integer) to service_role;
create index if not exists reel_jobs_page_status_due_idx
  on public.reel_jobs(page_id,status,scheduled_at);
