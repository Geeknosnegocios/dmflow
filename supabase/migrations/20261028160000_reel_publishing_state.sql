-- Persist exact approval and independent Reel/Story lifecycle state while
-- retaining the Reelsflow source identity (slug, idx) and legacy receipts.
alter table dmflow.scheduled_reels
  add column if not exists video_url text,
  add column if not exists caption text,
  add column if not exists canal text,
  add column if not exists scheduled_unix bigint,
  add column if not exists status text not null default 'pending',
  add column if not exists post_id text,
  add column if not exists permalink text,
  add column if not exists error text,
  add column if not exists container_id text,
  add column if not exists cover_url text,
  add column if not exists story_url text,
  add column if not exists story_status text,
  add column if not exists story_container_id text,
  add column if not exists story_post_id text,
  add column if not exists story_published_at timestamptz,
  add column if not exists story_error text,
  add column if not exists account_id uuid references dmflow.accounts(id),
  add column if not exists video_sha256 text,
  add column if not exists cover_sha256 text,
  add column if not exists story_sha256 text,
  add column if not exists approved_content_id uuid references dmflow.approved_content(id),
  add column if not exists approval_fingerprint text,
  add column if not exists story_approved_content_id uuid references dmflow.approved_content(id),
  add column if not exists story_approval_fingerprint text,
  add column if not exists publish_state text not null default 'unapproved',
  add column if not exists story_publish_state text not null default 'unapproved',
  add column if not exists container_status text,
  add column if not exists story_container_status text,
  add column if not exists claim_token text,
  add column if not exists lease_until timestamptz,
  add column if not exists publish_claimed_at timestamptz,
  add column if not exists story_claim_token text,
  add column if not exists story_lease_until timestamptz,
  add column if not exists story_claimed_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists permalink text,
  add column if not exists error text,
  add column if not exists story_permalink text;

alter table dmflow.scheduled_reels
  drop constraint if exists scheduled_reels_publish_state_check,
  add constraint scheduled_reels_publish_state_check
    check (publish_state in ('unapproved','pending','processing','published','needs_reconciliation','error','paused')),
  drop constraint if exists scheduled_reels_story_publish_state_check,
  add constraint scheduled_reels_story_publish_state_check
    check (story_publish_state in ('unapproved','pending','processing','published','needs_reconciliation','error','paused','disabled'));

create index if not exists scheduled_reels_due_publish_state_idx
  on dmflow.scheduled_reels (scheduled_unix, id) where publish_state = 'pending';
create index if not exists scheduled_reels_due_story_state_idx
  on dmflow.scheduled_reels (scheduled_unix, id) where story_publish_state = 'pending';
create unique index if not exists scheduled_reels_account_slot_unique
  on dmflow.scheduled_reels (account_id, scheduled_unix) where account_id is not null;

create table if not exists dmflow.instagram_reel_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  scheduled_reel_id uuid not null references dmflow.scheduled_reels(id),
  lane text not null check (lane in ('reel','story')),
  outcome text not null check (outcome in ('published','error')),
  external_post_id text,
  permalink text,
  published_at timestamptz,
  confirmed_no_post boolean not null default false,
  reason text not null,
  operator_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  unique (scheduled_reel_id, lane),
  constraint reel_reconciliation_evidence_check check (
    (outcome = 'published' and external_post_id is not null and permalink is not null
      and published_at is not null and confirmed_no_post is false)
    or (outcome = 'error' and external_post_id is null and permalink is null
      and published_at is null and confirmed_no_post is true)
  )
);

create table if not exists dmflow.instagram_reel_reconciliation_permits (
  transaction_id bigint not null,
  scheduled_reel_id uuid not null references dmflow.scheduled_reels(id),
  lane text not null check (lane in ('reel','story')),
  outcome text not null check (outcome in ('published','error')),
  operator_user_id uuid not null references auth.users(id),
  primary key (transaction_id, scheduled_reel_id, lane)
);

alter table dmflow.instagram_reel_reconciliation_events enable row level security;
alter table dmflow.instagram_reel_reconciliation_permits enable row level security;
revoke all on dmflow.instagram_reel_reconciliation_events from public, anon, authenticated, service_role;
revoke all on dmflow.instagram_reel_reconciliation_permits from public, anon, authenticated, service_role;
grant select on dmflow.instagram_reel_reconciliation_events to service_role;

create or replace function dmflow.guard_reel_approval_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_id is null or new.approved_content_id is null or new.approval_fingerprint is null
     or new.video_sha256 is null or new.video_sha256 !~* '^sha256:[0-9a-f]{64}$'
     or new.cover_sha256 is null or new.cover_sha256 !~* '^sha256:[0-9a-f]{64}$'
     or new.story_url is null or new.story_approved_content_id is null
     or new.story_approval_fingerprint is null
     or new.story_sha256 is null or new.story_sha256 !~* '^sha256:[0-9a-f]{64}$'
     or new.video_url is null or new.cover_url is null or new.caption is null or btrim(new.caption) = ''
     or new.scheduled_unix is null or new.scheduled_unix <= extract(epoch from statement_timestamp())
     or new.canal is null or new.canal not in ('GI','GN') then
    raise exception 'Reel and associated Story require approved assets and fingerprints';
  end if;
  perform pg_advisory_xact_lock(hashtext('reel-schedule:' || new.account_id::text || ':' ||
      ((to_timestamp(new.scheduled_unix)::timestamptz at time zone 'America/Sao_Paulo')::date)::text));
  if (select count(*) from dmflow.scheduled_reels q
      where q.account_id = new.account_id
        and (to_timestamp(q.scheduled_unix)::timestamptz at time zone 'America/Sao_Paulo')::date =
            (to_timestamp(new.scheduled_unix)::timestamptz at time zone 'America/Sao_Paulo')::date) >= 3 then
    raise exception 'Instagram Reel daily cap is three per BRT day';
  end if;
  if not exists (select 1 from dmflow.accounts a where a.id = new.account_id
      and a.active is true and lower(a.ig_username) = 'andreyogeek') then
    raise exception 'Reel queue accepts only the active andreyogeek account';
  end if;
  if not exists (
    select 1 from dmflow.approved_content a
    where a.id = new.approved_content_id
      and a.content_type = 'reel'
      and a.content_id = new.slug || ':' || new.idx::text
      and a.account_id = new.account_id
      and a.fingerprint = new.approval_fingerprint
      and a.revoked_at is null
  ) then
    raise exception 'Reel approval does not match source, account, or fingerprint';
  end if;
  if not exists (
    select 1 from dmflow.approved_content a
    where a.id = new.story_approved_content_id
      and a.content_type = 'reel_story'
      and a.content_id = new.slug || ':' || new.idx::text
      and a.account_id = new.account_id
      and a.fingerprint = new.story_approval_fingerprint
      and a.revoked_at is null
  ) then
    raise exception 'Associated Story approval does not match source, account, or fingerprint';
  end if;
  if new.status is distinct from 'pending' or new.publish_state is distinct from 'pending'
     or new.story_publish_state is distinct from 'pending' or new.claim_token is not null
     or new.story_claim_token is not null or new.post_id is not null
     or new.story_post_id is not null or new.container_id is not null
     or new.story_container_id is not null then
    raise exception 'New Reel batches must start pending with no Meta receipts';
  end if;
  new.story_status := 'pending';
  return new;
end;
$$;

create or replace function dmflow.guard_reel_approval_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status','story_status','publish_state','story_publish_state','container_status',
      'story_container_status','claim_token','lease_until','publish_claimed_at',
      'story_claim_token','story_lease_until','story_claimed_at',
      'container_id','story_container_id','post_id','story_post_id','published_at','story_published_at',
      'permalink','story_permalink','error','story_error','updated_at'])
     is distinct from
     (to_jsonb(old) - array['status','story_status','publish_state','story_publish_state','container_status',
      'story_container_status','claim_token','lease_until','publish_claimed_at',
      'story_claim_token','story_lease_until','story_claimed_at',
      'container_id','story_container_id','post_id','story_post_id','published_at','story_published_at',
      'permalink','story_permalink','error','story_error','updated_at']) then
    raise exception 'Approved Reel package fields are immutable; create a newly approved batch';
  end if;
  if old.publish_state in ('needs_reconciliation','error','published') and new.publish_state <> old.publish_state then
    if old.publish_state <> 'needs_reconciliation' or not exists (
      select 1 from dmflow.instagram_reel_reconciliation_permits p
      where p.transaction_id = txid_current() and p.scheduled_reel_id = old.id
        and p.lane = 'reel' and p.outcome = new.publish_state
    ) then
      raise exception 'Reel terminal state can only be resolved with external proof through the reconciliation RPC';
    end if;
  end if;
  if new.publish_state = 'published' and old.publish_state is distinct from new.publish_state
     and old.publish_state not in ('processing','needs_reconciliation') then
    raise exception 'Reel publication requires a claimed operation or verified reconciliation';
  end if;
  if (new.publish_state = 'published' and new.status is distinct from 'published')
     or (new.publish_state in ('error','needs_reconciliation') and new.status is distinct from 'error') then
    raise exception 'Reel status must match its terminal publication state';
  end if;
  if old.publish_state in ('error','published') and new.status is distinct from old.status then
    raise exception 'Resolved Reel states cannot be requeued or rewritten';
  end if;
  if old.publish_state = 'needs_reconciliation' and new.publish_state = old.publish_state
     and new.status is distinct from old.status then
    raise exception 'Reel reconciliation status can only change through the resolution RPC';
  end if;
  if old.story_publish_state in ('needs_reconciliation','error','published')
     and new.story_publish_state <> old.story_publish_state then
    if old.story_publish_state <> 'needs_reconciliation' or not exists (
      select 1 from dmflow.instagram_reel_reconciliation_permits p
      where p.transaction_id = txid_current() and p.scheduled_reel_id = old.id
        and p.lane = 'story' and p.outcome = new.story_publish_state
    ) then
      raise exception 'Story terminal state can only be resolved with external proof through the reconciliation RPC';
    end if;
  end if;
  if new.story_publish_state = 'published' and old.story_publish_state is distinct from new.story_publish_state
     and old.story_publish_state not in ('processing','needs_reconciliation') then
    raise exception 'Story publication requires a claimed operation or verified reconciliation';
  end if;
  if (new.story_publish_state = 'published' and new.story_status is distinct from 'published')
     or (new.story_publish_state in ('error','needs_reconciliation') and new.story_status is distinct from 'error') then
    raise exception 'Story status must match its terminal publication state';
  end if;
  if old.story_publish_state in ('error','published') and new.story_status is distinct from old.story_status then
    raise exception 'Resolved Reel Story states cannot be requeued or rewritten';
  end if;
  if old.story_publish_state = 'needs_reconciliation' and new.story_publish_state = old.story_publish_state
     and new.story_status is distinct from old.story_status then
    raise exception 'Story reconciliation status can only change through the resolution RPC';
  end if;
  return new;
end;
$$;

create or replace function dmflow.guard_reel_reconciliation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Reel reconciliation history is immutable';
end;
$$;

revoke all on function dmflow.guard_reel_reconciliation_event() from public, anon, authenticated;
drop trigger if exists reel_reconciliation_event_immutable on dmflow.instagram_reel_reconciliation_events;
create trigger reel_reconciliation_event_immutable
before update or delete on dmflow.instagram_reel_reconciliation_events
for each row execute function dmflow.guard_reel_reconciliation_event();

create or replace function dmflow.resolve_reel_publication(
  p_scheduled_reel_id uuid,
  p_lane text,
  p_outcome text,
  p_operator_user_id uuid,
  p_external_post_id text default null,
  p_permalink text default null,
  p_published_at timestamptz default null,
  p_confirmed_no_post boolean default false,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_status text;
  v_publish_state text;
  v_story_status text;
  v_story_publish_state text;
  v_existing_post_id text;
  v_existing_story_post_id text;
  v_event_id uuid;
begin
  if p_lane is null or p_lane not in ('reel','story') then
    raise exception 'Resolution lane must be reel or story';
  end if;
  if p_outcome is null or p_outcome not in ('published','error') then
    raise exception 'Resolution must be published or error';
  end if;
  if p_operator_user_id is null or p_scheduled_reel_id is null then
    raise exception 'Queue item and authenticated operator owner are required';
  end if;
  if p_reason is null or btrim(p_reason) = '' or length(p_reason) > 500 then
    raise exception 'A bounded operator explanation is required';
  end if;

  select q.account_id, q.status, q.publish_state, q.story_status, q.story_publish_state,
         q.post_id, q.story_post_id
    into v_account_id, v_status, v_publish_state, v_story_status, v_story_publish_state,
         v_existing_post_id, v_existing_story_post_id
    from dmflow.scheduled_reels q
   where q.id = p_scheduled_reel_id
   for update;
  if not found then raise exception 'Reel queue item not found'; end if;
  if not exists (select 1 from dmflow.accounts a where a.id = v_account_id
      and a.owner_user_id = p_operator_user_id) then
    raise exception 'Only the owning account operator can resolve this queue item';
  end if;

  if p_outcome = 'published' then
    if p_confirmed_no_post is distinct from false or p_external_post_id is null
       or btrim(p_external_post_id) = '' or p_permalink is null or p_published_at is null
       or p_published_at > statement_timestamp() + interval '5 minutes' then
      raise exception 'Published resolution requires external post id, permalink, and publish time';
    end if;
    if (p_lane = 'reel' and v_existing_post_id is not null and v_existing_post_id <> p_external_post_id)
       or (p_lane = 'story' and v_existing_story_post_id is not null and v_existing_story_post_id <> p_external_post_id) then
      raise exception 'External proof must match any Meta post id already recorded';
    end if;
    if p_lane = 'reel' and p_permalink !~* '^https://(www\.)?instagram\.com/(reel|p)/[A-Za-z0-9_-]+/?$' then
      raise exception 'Reel proof permalink must be an Instagram Reel or post URL';
    end if;
    if p_lane = 'story' and p_permalink !~* '^https://(www\.)?instagram\.com/stories/andreyogeek/[A-Za-z0-9_-]+/?$' then
      raise exception 'Story proof permalink must identify an andreyogeek Instagram Story';
    end if;
  else
    if p_confirmed_no_post is distinct from true or p_external_post_id is not null
       or p_permalink is not null or p_published_at is not null then
      raise exception 'Error resolution requires explicit no-post confirmation and no post receipt';
    end if;
    if (p_lane = 'reel' and v_existing_post_id is not null)
       or (p_lane = 'story' and v_existing_story_post_id is not null) then
      raise exception 'A stored Meta post id cannot be resolved as no-post';
    end if;
  end if;

  if p_lane = 'reel' and v_publish_state <> 'needs_reconciliation' then
    raise exception 'Reel lane is not awaiting manual reconciliation';
  end if;
  if p_lane = 'story' and (v_publish_state <> 'published' or v_story_publish_state <> 'needs_reconciliation') then
    raise exception 'Story lane requires a published parent Reel and pending manual reconciliation';
  end if;

  insert into dmflow.instagram_reel_reconciliation_permits
    (transaction_id, scheduled_reel_id, lane, outcome, operator_user_id)
  values (txid_current(), p_scheduled_reel_id, p_lane, p_outcome, p_operator_user_id);

  if p_lane = 'reel' then
    if p_outcome = 'published' then
      update dmflow.scheduled_reels
         set status = 'published', publish_state = 'published', post_id = p_external_post_id,
             permalink = p_permalink, published_at = p_published_at, error = null,
             claim_token = null, lease_until = null
       where id = p_scheduled_reel_id and publish_state = 'needs_reconciliation';
    else
      update dmflow.scheduled_reels
         set status = 'error', publish_state = 'error', error = p_reason,
             claim_token = null, lease_until = null
       where id = p_scheduled_reel_id and publish_state = 'needs_reconciliation';
    end if;
  elsif p_outcome = 'published' then
    update dmflow.scheduled_reels
       set story_status = 'published', story_publish_state = 'published', story_post_id = p_external_post_id,
           story_permalink = p_permalink, story_published_at = p_published_at, story_error = null,
           story_claim_token = null, story_lease_until = null
     where id = p_scheduled_reel_id and story_publish_state = 'needs_reconciliation';
  else
    update dmflow.scheduled_reels
       set story_status = 'error', story_publish_state = 'error', story_error = p_reason,
           story_claim_token = null, story_lease_until = null
     where id = p_scheduled_reel_id and story_publish_state = 'needs_reconciliation';
  end if;

  if not found then raise exception 'Reel publication state changed before reconciliation could be saved'; end if;

  insert into dmflow.instagram_reel_reconciliation_events
    (scheduled_reel_id, lane, outcome, external_post_id, permalink, published_at,
     confirmed_no_post, reason, operator_user_id)
  values (p_scheduled_reel_id, p_lane, p_outcome, p_external_post_id, p_permalink,
          p_published_at, p_confirmed_no_post, p_reason, p_operator_user_id)
  returning id into v_event_id;

  delete from dmflow.instagram_reel_reconciliation_permits
   where transaction_id = txid_current() and scheduled_reel_id = p_scheduled_reel_id and lane = p_lane;
  return v_event_id;
end;
$$;

revoke all on function dmflow.guard_reel_approval_insert() from public, anon, authenticated;
revoke all on function dmflow.guard_reel_approval_update() from public, anon, authenticated;
drop trigger if exists scheduled_reels_require_approval on dmflow.scheduled_reels;
create trigger scheduled_reels_require_approval
before insert on dmflow.scheduled_reels
for each row execute function dmflow.guard_reel_approval_insert();
drop trigger if exists scheduled_reels_approval_immutable on dmflow.scheduled_reels;
create trigger scheduled_reels_approval_immutable
before update on dmflow.scheduled_reels
for each row execute function dmflow.guard_reel_approval_update();

alter table dmflow.scheduled_reels enable row level security;
revoke all on dmflow.scheduled_reels from public, anon, authenticated, service_role;
grant select, insert, update on dmflow.scheduled_reels to service_role;
revoke all on function dmflow.resolve_reel_publication(uuid,text,text,uuid,text,text,timestamptz,boolean,text)
  from public, anon, authenticated, service_role;
grant execute on function dmflow.resolve_reel_publication(uuid,text,text,uuid,text,text,timestamptz,boolean,text)
  to service_role;

create or replace function dmflow.claim_due_reel(p_reel_id uuid, p_fingerprint text, p_now timestamptz)
returns setof dmflow.scheduled_reels
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed dmflow.scheduled_reels;
  v_day date := (p_now at time zone 'America/Sao_Paulo')::date;
begin
  if p_now is null or p_fingerprint is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('reel-publish:' || v_day::text));
  if (select count(*) from dmflow.scheduled_reels q
      where ((q.publish_claimed_at at time zone 'America/Sao_Paulo')::date = v_day)
        or (q.publish_claimed_at is null
          and (to_timestamp(q.scheduled_unix)::timestamptz at time zone 'America/Sao_Paulo')::date = v_day
          and q.status in ('processing','published','error'))) >= 3 then return; end if;

  update dmflow.scheduled_reels q
     set status = 'processing', publish_state = 'processing',
         claim_token = gen_random_uuid()::text, lease_until = p_now + interval '5 minutes',
         publish_claimed_at = coalesce(publish_claimed_at, p_now),
         error = null, updated_at = p_now
   where q.id = p_reel_id and q.status = 'pending' and q.publish_state = 'pending'
     and to_timestamp(q.scheduled_unix) <= p_now
     and q.approval_fingerprint = p_fingerprint
     and q.approved_content_id is not null
     and exists (select 1 from dmflow.accounts a where a.id = q.account_id
       and a.active is true and lower(a.ig_username) = 'andreyogeek')
     and exists (select 1 from dmflow.approved_content a where a.id = q.approved_content_id
       and a.content_type = 'reel' and a.content_id = q.slug || ':' || q.idx::text
       and a.account_id = q.account_id and a.fingerprint = p_fingerprint and a.revoked_at is null)
   returning q.* into v_claimed;
  if not found then return; end if;
  return next v_claimed;
end;
$$;

create or replace function dmflow.claim_due_reel_story(p_reel_id uuid, p_fingerprint text, p_now timestamptz)
returns setof dmflow.scheduled_reels
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed dmflow.scheduled_reels;
  v_day date := (p_now at time zone 'America/Sao_Paulo')::date;
begin
  if p_now is null or p_fingerprint is null then return; end if;
  perform pg_advisory_xact_lock(hashtext('reel-story-publish:' || v_day::text));
  if (select count(*) from dmflow.scheduled_reels q
      where ((q.story_claimed_at at time zone 'America/Sao_Paulo')::date = v_day)
        or (q.story_claimed_at is null
          and (to_timestamp(q.scheduled_unix)::timestamptz at time zone 'America/Sao_Paulo')::date = v_day
          and q.story_status in ('processing','published','error'))) >= 3 then return; end if;

  update dmflow.scheduled_reels q
     set story_status = 'processing', story_publish_state = 'processing',
         story_claim_token = gen_random_uuid()::text, story_lease_until = p_now + interval '5 minutes',
         story_claimed_at = coalesce(story_claimed_at, p_now),
         story_error = null, updated_at = p_now
   where q.id = p_reel_id and q.status = 'published' and q.publish_state = 'published'
     and q.story_status = 'pending' and q.story_publish_state = 'pending'
     and q.story_url is not null and q.story_post_id is null
     and q.approved_content_id is not null and q.story_approved_content_id is not null
     and q.story_approval_fingerprint = p_fingerprint
     and exists (select 1 from dmflow.accounts a where a.id = q.account_id
       and a.active is true and lower(a.ig_username) = 'andreyogeek')
     and exists (select 1 from dmflow.approved_content a where a.id = q.approved_content_id
       and a.content_type = 'reel' and a.content_id = q.slug || ':' || q.idx::text
       and a.account_id = q.account_id and a.fingerprint = q.approval_fingerprint and a.revoked_at is null)
     and exists (select 1 from dmflow.approved_content a where a.id = q.story_approved_content_id
       and a.content_type = 'reel_story' and a.content_id = q.slug || ':' || q.idx::text
       and a.account_id = q.account_id and a.fingerprint = p_fingerprint and a.revoked_at is null)
   returning q.* into v_claimed;
  if not found then return; end if;
  return next v_claimed;
end;
$$;

revoke all on function dmflow.claim_due_reel(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function dmflow.claim_due_reel_story(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function dmflow.claim_due_reel(uuid,text,timestamptz) to service_role;
grant execute on function dmflow.claim_due_reel_story(uuid,text,timestamptz) to service_role;

