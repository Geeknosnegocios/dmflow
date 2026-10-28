-- One disabled-by-default lease controls all local Instagram publishing lanes.
create table if not exists dmflow.instagram_dispatcher_state (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  last_lane text check (last_lane is null or last_lane in ('carousel','reel','reel_story','metadata')),
  claim_token text,
  lease_until timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

insert into dmflow.instagram_dispatcher_state (id, enabled)
values (1, false)
on conflict (id) do nothing;

create unique index if not exists scheduled_carousels_account_slot_unique
  on dmflow.scheduled_carousels (account_id, publish_at);

alter table dmflow.instagram_dispatcher_state enable row level security;
revoke all on dmflow.instagram_dispatcher_state from public, anon, authenticated, service_role;

create or replace function dmflow.claim_instagram_dispatcher_tick(p_now timestamptz)
returns table(claim_token text, lane text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_last_lane text;
  v_lanes text[] := array['carousel','reel','reel_story','metadata'];
  v_offset integer;
  v_index integer;
  v_lane text;
  v_due boolean;
begin
  if p_now is null then raise exception 'dispatcher timestamp is required'; end if;

  update dmflow.instagram_dispatcher_state s
     set claim_token = gen_random_uuid()::text,
         lease_until = p_now + interval '3 minutes',
         updated_at = p_now
   where s.id = 1 and s.enabled is true
     and (s.claim_token is null or s.lease_until <= p_now)
   returning s.claim_token, s.last_lane into v_token, v_last_lane;
  if not found then return; end if;

  for v_offset in 1..cardinality(v_lanes) loop
    v_index := ((coalesce(array_position(v_lanes, v_last_lane), 0) + v_offset - 1)
      % cardinality(v_lanes)) + 1;
    v_lane := v_lanes[v_index];
    if v_lane = 'carousel' then
      select exists (select 1 from dmflow.scheduled_carousels q
        where q.status = 'scheduled' and q.publish_at <= p_now
          and exists (select 1 from dmflow.accounts a where a.id=q.account_id
            and a.active is true and lower(a.ig_username)='andreyogeek')
          and exists (select 1 from dmflow.approved_content a where a.content_type='carousel'
            and a.content_id=q.card_id and a.account_id=q.account_id
            and a.fingerprint=q.approval_fingerprint and a.revoked_at is null)) into v_due;
    elsif v_lane = 'reel' then
      select exists (select 1 from dmflow.scheduled_reels q
        where q.status = 'pending' and q.publish_state = 'pending'
          and to_timestamp(q.scheduled_unix) <= p_now
          and exists (select 1 from dmflow.accounts a where a.id=q.account_id
            and a.active is true and lower(a.ig_username)='andreyogeek')
          and exists (select 1 from dmflow.approved_content a where a.id=q.approved_content_id
            and a.content_type='reel' and a.content_id=q.slug||':'||q.idx::text
            and a.account_id=q.account_id and a.fingerprint=q.approval_fingerprint and a.revoked_at is null)) into v_due;
    elsif v_lane = 'reel_story' then
      select exists (select 1 from dmflow.scheduled_reels q
        where q.status = 'published' and q.publish_state = 'published'
          and q.story_status = 'pending' and q.story_publish_state = 'pending'
          and to_timestamp(q.scheduled_unix) <= p_now
          and exists (select 1 from dmflow.accounts a where a.id=q.account_id
            and a.active is true and lower(a.ig_username)='andreyogeek')
          and exists (select 1 from dmflow.approved_content a where a.id=q.story_approved_content_id
            and a.content_type='reel_story' and a.content_id=q.slug||':'||q.idx::text
            and a.account_id=q.account_id and a.fingerprint=q.story_approval_fingerprint and a.revoked_at is null)) into v_due;
    else
      select exists (select 1 from dmflow.scheduled_reels q
        where q.status = 'published' and q.publish_state = 'published'
          and q.metadata_status = 'pending' and q.post_id is not null
          and q.permalink is null and to_timestamp(q.scheduled_unix) <= p_now
          and exists (select 1 from dmflow.accounts a where a.id=q.account_id
            and a.active is true and lower(a.ig_username)='andreyogeek')) into v_due;
    end if;
    if v_due then
      update dmflow.instagram_dispatcher_state s
         set last_lane = v_lane, updated_at = p_now
       where s.id = 1 and s.claim_token = v_token;
      claim_token := v_token;
      lane := v_lane;
      return next;
      return;
    end if;
  end loop;

  update dmflow.instagram_dispatcher_state s
     set claim_token = null, lease_until = null, updated_at = p_now
   where s.id = 1 and s.claim_token = v_token;
  return;
end;
$$;

create or replace function dmflow.release_instagram_dispatcher_tick(p_claim_token text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if p_claim_token is null or p_now is null then return false; end if;
  update dmflow.instagram_dispatcher_state s
     set claim_token = null, lease_until = null, updated_at = p_now
   where s.id = 1 and s.claim_token = p_claim_token;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function dmflow.set_instagram_dispatcher_enabled(p_enabled boolean, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if p_enabled is null or p_now is null then return false; end if;
  update dmflow.instagram_dispatcher_state s
     set enabled = p_enabled, updated_at = p_now
   where s.id = 1
     and (p_enabled is true or s.claim_token is null or s.lease_until <= p_now);
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function dmflow.claim_instagram_dispatcher_tick(timestamptz) from public, anon, authenticated;
revoke all on function dmflow.release_instagram_dispatcher_tick(text,timestamptz) from public, anon, authenticated;
revoke all on function dmflow.set_instagram_dispatcher_enabled(boolean,timestamptz) from public, anon, authenticated;
grant execute on function dmflow.claim_instagram_dispatcher_tick(timestamptz) to service_role;
grant execute on function dmflow.release_instagram_dispatcher_tick(text,timestamptz) to service_role;
grant execute on function dmflow.set_instagram_dispatcher_enabled(boolean,timestamptz) to service_role;
