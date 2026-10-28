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
  if old.publish_state = 'needs_reconciliation' and new.publish_state <> old.publish_state then
    raise exception 'Ambiguous Reel publication requires manual reconciliation';
  end if;
  if old.story_publish_state = 'needs_reconciliation' and new.story_publish_state <> old.story_publish_state then
    raise exception 'Ambiguous Story publication requires manual reconciliation';
  end if;
  return new;
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

