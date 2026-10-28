-- Distinguish durable receipt from the later permalink/timestamp lookup, and
-- make every external Graph call recoverable from an explicit pre-call phase.
alter table dmflow.scheduled_reels
  add column if not exists action_kind text,
  add column if not exists action_started_at timestamptz,
  add column if not exists story_action_kind text,
  add column if not exists story_action_started_at timestamptz,
  add column if not exists metadata_status text not null default 'unapproved',
  add column if not exists metadata_claim_token text,
  add column if not exists metadata_lease_until timestamptz,
  add column if not exists metadata_claimed_at timestamptz,
  add column if not exists metadata_action_started_at timestamptz,
  add column if not exists metadata_error text,
  add column if not exists provider_published_at timestamptz;

alter table dmflow.scheduled_reels
  drop constraint if exists scheduled_reels_action_kind_check,
  add constraint scheduled_reels_action_kind_check
    check (action_kind is null or action_kind in ('create','poll','publish')),
  drop constraint if exists scheduled_reels_story_action_kind_check,
  add constraint scheduled_reels_story_action_kind_check
    check (story_action_kind is null or story_action_kind in ('create','poll','publish')),
  drop constraint if exists scheduled_reels_metadata_status_check,
  add constraint scheduled_reels_metadata_status_check
    check (metadata_status in ('unapproved','pending','processing','published','needs_reconciliation','error','paused'));

create index if not exists scheduled_reels_due_metadata_idx
  on dmflow.scheduled_reels (metadata_claimed_at, id) where metadata_status = 'pending';

create or replace function dmflow.begin_reel_graph_action(
  p_reel_id uuid, p_lane text, p_claim_token text, p_action text, p_now timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if p_lane = 'reel' then
    if p_action not in ('create','poll','publish') then raise exception 'invalid Reel Graph phase'; end if;
    update dmflow.scheduled_reels q set action_kind=p_action, action_started_at=p_now
     where q.id=p_reel_id and q.publish_state='processing' and q.claim_token=p_claim_token
       and q.lease_until > p_now and q.action_kind is null
       and ((p_action='create' and q.container_id is null)
         or (p_action='poll' and q.container_id is not null and q.container_status is distinct from 'FINISHED')
         or (p_action='publish' and q.container_id is not null and q.container_status='FINISHED' and q.post_id is null));
  elsif p_lane = 'story' then
    if p_action not in ('create','poll','publish') then raise exception 'invalid Story Graph phase'; end if;
    update dmflow.scheduled_reels q set story_action_kind=p_action, story_action_started_at=p_now
     where q.id=p_reel_id and q.status='published' and q.publish_state='published'
       and q.story_publish_state='processing' and q.story_claim_token=p_claim_token
       and q.story_lease_until > p_now and q.story_action_kind is null
       and ((p_action='create' and q.story_container_id is null)
         or (p_action='poll' and q.story_container_id is not null and q.story_container_status is distinct from 'FINISHED')
         or (p_action='publish' and q.story_container_id is not null and q.story_container_status='FINISHED' and q.story_post_id is null));
  elsif p_lane = 'metadata' and p_action = 'lookup' then
    update dmflow.scheduled_reels q set metadata_action_started_at=p_now
     where q.id=p_reel_id and q.status='published' and q.publish_state='published' and q.post_id is not null
       and q.metadata_status='processing' and q.metadata_claim_token=p_claim_token
       and q.metadata_lease_until > p_now and q.metadata_action_started_at is null;
  else
    raise exception 'invalid publishing lane or Graph phase';
  end if;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function dmflow.claim_due_reel_metadata(p_reel_id uuid, p_now timestamptz)
returns setof dmflow.scheduled_reels
language sql
security invoker
set search_path = ''
as $$
  update dmflow.scheduled_reels q
     set metadata_status='processing', metadata_claim_token=gen_random_uuid()::text,
         metadata_lease_until=p_now + interval '5 minutes', metadata_claimed_at=coalesce(q.metadata_claimed_at,p_now),
         metadata_error=null, metadata_action_started_at=null
   where p_now is not null and q.id=p_reel_id and q.status='published' and q.publish_state='published'
     and q.post_id is not null and q.metadata_status='pending' and q.permalink is null
   returning q.*;
$$;

create or replace function dmflow.recover_expired_reel_claims(p_now timestamptz)
returns table(scheduled_reel_id uuid, lane text, outcome text)
language plpgsql
security invoker
set search_path = ''
as $$
declare v_row record;
begin
  if p_now is null then raise exception 'recovery timestamp is required'; end if;
  for v_row in
    select q.id, q.action_kind from dmflow.scheduled_reels q
    where q.publish_state='processing' and q.lease_until <= p_now
    order by q.lease_until for update of q skip locked
  loop
    if v_row.action_kind in ('create','publish') then
      update dmflow.scheduled_reels q set status='error', publish_state='needs_reconciliation',
        error='Expired lease after a Reel create/publish request began; external result requires manual reconciliation',
        claim_token=null, lease_until=null, action_kind=null, action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='reel'; outcome:='needs_reconciliation'; return next;
    else
      update dmflow.scheduled_reels q set status='pending', publish_state='pending', error=null,
        claim_token=null, lease_until=null, action_kind=null, action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='reel'; outcome:='reclaimed_safe_poll'; return next;
    end if;
  end loop;

  for v_row in
    select q.id, q.story_action_kind from dmflow.scheduled_reels q
    where q.story_publish_state='processing' and q.story_lease_until <= p_now
    order by q.story_lease_until for update of q skip locked
  loop
    if v_row.story_action_kind in ('create','publish') then
      update dmflow.scheduled_reels q set story_status='error', story_publish_state='needs_reconciliation',
        story_error='Expired lease after a Story create/publish request began; external result requires manual reconciliation',
        story_claim_token=null, story_lease_until=null, story_action_kind=null, story_action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='story'; outcome:='needs_reconciliation'; return next;
    else
      update dmflow.scheduled_reels q set story_status='pending', story_publish_state='pending', story_error=null,
        story_claim_token=null, story_lease_until=null, story_action_kind=null, story_action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='story'; outcome:='reclaimed_safe_poll'; return next;
    end if;
  end loop;

  for v_row in
    select q.id from dmflow.scheduled_reels q
    where q.metadata_status='processing' and q.metadata_lease_until <= p_now
    order by q.metadata_lease_until for update of q skip locked
  loop
    update dmflow.scheduled_reels q set metadata_status='pending', metadata_claim_token=null,
      metadata_lease_until=null, metadata_action_started_at=null
    where q.id=v_row.id;
    scheduled_reel_id:=v_row.id; lane:='metadata'; outcome:='reclaimed_safe_get'; return next;
  end loop;
  return;
end;
$$;

revoke all on function dmflow.begin_reel_graph_action(uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function dmflow.claim_due_reel_metadata(uuid,timestamptz) from public, anon, authenticated;
revoke all on function dmflow.recover_expired_reel_claims(timestamptz) from public, anon, authenticated;
grant execute on function dmflow.begin_reel_graph_action(uuid,text,text,text,timestamptz) to service_role;
grant execute on function dmflow.claim_due_reel_metadata(uuid,timestamptz) to service_role;
grant execute on function dmflow.recover_expired_reel_claims(timestamptz) to service_role;

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
    where a.id = new.approved_content_id and a.content_type = 'reel'
      and a.content_id = new.slug || ':' || new.idx::text and a.account_id = new.account_id
      and a.fingerprint = new.approval_fingerprint and a.revoked_at is null
  ) then raise exception 'Reel approval does not match source, account, or fingerprint'; end if;
  if not exists (
    select 1 from dmflow.approved_content a
    where a.id = new.story_approved_content_id and a.content_type = 'reel_story'
      and a.content_id = new.slug || ':' || new.idx::text and a.account_id = new.account_id
      and a.fingerprint = new.story_approval_fingerprint and a.revoked_at is null
  ) then raise exception 'Associated Story approval does not match source, account, or fingerprint'; end if;
  if new.status is distinct from 'pending' or new.publish_state is distinct from 'pending'
     or new.story_publish_state is distinct from 'pending' or new.claim_token is not null
     or new.story_claim_token is not null or new.post_id is not null or new.story_post_id is not null
     or new.container_id is not null or new.story_container_id is not null then
    raise exception 'New Reel batches must start pending with no Meta receipts';
  end if;
  new.story_status := 'pending';
  new.metadata_status := 'pending';
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
      'story_container_status','claim_token','lease_until','publish_claimed_at','action_kind','action_started_at',
      'story_claim_token','story_lease_until','story_claimed_at','story_action_kind','story_action_started_at',
      'metadata_status','metadata_claim_token','metadata_lease_until','metadata_claimed_at','metadata_action_started_at',
      'metadata_error','provider_published_at','container_id','story_container_id','post_id',
      'story_post_id','published_at','story_published_at','permalink','story_permalink','error','story_error','updated_at'])
     is distinct from
     (to_jsonb(old) - array['status','story_status','publish_state','story_publish_state','container_status',
      'story_container_status','claim_token','lease_until','publish_claimed_at','action_kind','action_started_at',
      'story_claim_token','story_lease_until','story_claimed_at','story_action_kind','story_action_started_at',
      'metadata_status','metadata_claim_token','metadata_lease_until','metadata_claimed_at','metadata_action_started_at',
      'metadata_error','provider_published_at','container_id','story_container_id','post_id',
      'story_post_id','published_at','story_published_at','permalink','story_permalink','error','story_error','updated_at']) then
    raise exception 'Approved Reel package fields are immutable; create a newly approved batch';
  end if;
  if old.publish_state in ('needs_reconciliation','error','published') and new.publish_state <> old.publish_state then
    if old.publish_state <> 'needs_reconciliation' or not exists (
      select 1 from dmflow.instagram_reel_reconciliation_permits p
      where p.transaction_id=txid_current() and p.scheduled_reel_id=old.id and p.lane='reel' and p.outcome=new.publish_state
    ) then raise exception 'Reel terminal state can only be resolved with external proof through the reconciliation RPC'; end if;
  end if;
  if new.publish_state='published' and old.publish_state is distinct from new.publish_state
     and old.publish_state not in ('processing','needs_reconciliation') then
    raise exception 'Reel publication requires a claimed operation or verified reconciliation';
  end if;
  if (new.publish_state='published' and new.status is distinct from 'published')
     or (new.publish_state in ('error','needs_reconciliation') and new.status is distinct from 'error') then
    raise exception 'Reel status must match its terminal publication state';
  end if;
  if old.publish_state in ('error','published') and new.status is distinct from old.status then
    raise exception 'Resolved Reel states cannot be requeued or rewritten';
  end if;
  if old.publish_state='needs_reconciliation' and new.publish_state=old.publish_state and new.status is distinct from old.status then
    raise exception 'Reel reconciliation status can only change through the resolution RPC';
  end if;
  if old.story_publish_state in ('needs_reconciliation','error','published') and new.story_publish_state <> old.story_publish_state then
    if old.story_publish_state <> 'needs_reconciliation' or not exists (
      select 1 from dmflow.instagram_reel_reconciliation_permits p
      where p.transaction_id=txid_current() and p.scheduled_reel_id=old.id and p.lane='story' and p.outcome=new.story_publish_state
    ) then raise exception 'Story terminal state can only be resolved with external proof through the reconciliation RPC'; end if;
  end if;
  if new.story_publish_state='published' and old.story_publish_state is distinct from new.story_publish_state
     and old.story_publish_state not in ('processing','needs_reconciliation') then
    raise exception 'Story publication requires a claimed operation or verified reconciliation';
  end if;
  if (new.story_publish_state='published' and new.story_status is distinct from 'published')
     or (new.story_publish_state in ('error','needs_reconciliation') and new.story_status is distinct from 'error') then
    raise exception 'Story status must match its terminal publication state';
  end if;
  if old.story_publish_state in ('error','published') and new.story_status is distinct from old.story_status then
    raise exception 'Resolved Reel Story states cannot be requeued or rewritten';
  end if;
  if old.story_publish_state='needs_reconciliation' and new.story_publish_state=old.story_publish_state
     and new.story_status is distinct from old.story_status then
    raise exception 'Story reconciliation status can only change through the resolution RPC';
  end if;
  if old.publish_state='needs_reconciliation' and new.publish_state in ('published','error')
     and exists (select 1 from dmflow.instagram_reel_reconciliation_permits p
       where p.transaction_id=txid_current() and p.scheduled_reel_id=old.id and p.lane='reel'
         and p.outcome=new.publish_state) then
    if new.publish_state='published' then
      new.metadata_status:='published';
      new.provider_published_at:=new.published_at;
      new.metadata_error:=null;
    else
      new.metadata_status:='error';
      new.metadata_error:=new.error;
    end if;
  end if;
  if old.metadata_status in ('published','error','needs_reconciliation') and new.metadata_status <> old.metadata_status then
    raise exception 'Reel metadata terminal state cannot be reset';
  end if;
  if new.metadata_status='published' and old.metadata_status is distinct from new.metadata_status
     and old.metadata_status <> 'processing'
     and not exists (select 1 from dmflow.instagram_reel_reconciliation_permits p
       where p.transaction_id=txid_current() and p.scheduled_reel_id=old.id and p.lane='reel' and p.outcome='published') then
    raise exception 'Reel metadata requires a claimed lookup';
  end if;
  return new;
end;
$$;

create or replace function dmflow.begin_reel_graph_action(p_reel_id uuid, p_lane text, p_claim_token text, p_action text, p_now timestamptz)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  if p_lane='reel' then
    if p_action not in ('create','poll','publish') then raise exception 'invalid Reel Graph phase'; end if;
    update dmflow.scheduled_reels q
       set action_kind=p_action, action_started_at=p_now
     where q.id=p_reel_id and q.publish_state='processing' and q.claim_token=p_claim_token
       and q.lease_until > p_now and q.action_kind is null
       and ((p_action='create' and q.container_id is null)
         or (p_action='poll' and q.container_id is not null and q.container_status is distinct from 'FINISHED')
         or (p_action='publish' and q.container_id is not null and q.container_status='FINISHED' and q.post_id is null));
  elsif p_lane='story' then
    if p_action not in ('create','poll','publish') then raise exception 'invalid Story Graph phase'; end if;
    update dmflow.scheduled_reels q
       set story_action_kind=p_action, story_action_started_at=p_now
     where q.id=p_reel_id and q.status='published' and q.publish_state='published'
       and q.story_publish_state='processing' and q.story_claim_token=p_claim_token
       and q.story_lease_until > p_now and q.story_action_kind is null
       and ((p_action='create' and q.story_container_id is null)
         or (p_action='poll' and q.story_container_id is not null and q.story_container_status is distinct from 'FINISHED')
         or (p_action='publish' and q.story_container_id is not null and q.story_container_status='FINISHED' and q.story_post_id is null));
  elsif p_lane='metadata' and p_action='lookup' then
    update dmflow.scheduled_reels q
       set metadata_action_started_at=p_now
     where q.id=p_reel_id and q.publish_state='published' and q.post_id is not null
       and q.metadata_status='processing' and q.metadata_claim_token=p_claim_token
       and q.metadata_lease_until > p_now and q.metadata_action_started_at is null;
  else
    raise exception 'invalid publishing lane or Graph phase';
  end if;
  get diagnostics v_count = row_count;
  return v_count=1;
end;
$$;

create or replace function dmflow.claim_due_reel_metadata(p_reel_id uuid, p_now timestamptz)
returns setof dmflow.scheduled_reels
language sql
security invoker
set search_path = ''
as $$
  update dmflow.scheduled_reels q
     set metadata_status='processing', metadata_claim_token=gen_random_uuid()::text,
         metadata_lease_until=p_now + interval '5 minutes', metadata_claimed_at=coalesce(q.metadata_claimed_at,p_now),
         metadata_error=null, metadata_action_started_at=null
   where q.id=p_reel_id and q.publish_state='published' and q.status='published' and q.post_id is not null
     and q.metadata_status='pending' and q.permalink is null
   returning q.*;
$$;

create or replace function dmflow.recover_expired_reel_claims(p_now timestamptz)
returns table(scheduled_reel_id uuid, lane text, outcome text)
language plpgsql
security invoker
set search_path = ''
as $$
declare v_row record;
begin
  for v_row in select q.id, q.action_kind from dmflow.scheduled_reels q
      where q.publish_state='processing' and q.lease_until <= p_now
      order by q.lease_until for update of q skip locked loop
    if v_row.action_kind in ('create','publish') then
      update dmflow.scheduled_reels q set status='error', publish_state='needs_reconciliation',
        error='Expired lease after a Reel create/publish request began; external result requires manual reconciliation',
        claim_token=null, lease_until=null, action_kind=null, action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='reel'; outcome:='needs_reconciliation'; return next;
    else
      update dmflow.scheduled_reels q set status='pending', publish_state='pending', error=null,
        claim_token=null, lease_until=null, action_kind=null, action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='reel'; outcome:='reclaimed_safe_poll'; return next;
    end if;
  end loop;
  for v_row in select q.id, q.story_action_kind from dmflow.scheduled_reels q
      where q.story_publish_state='processing' and q.story_lease_until <= p_now
      order by q.story_lease_until for update of q skip locked loop
    if v_row.story_action_kind in ('create','publish') then
      update dmflow.scheduled_reels q set story_status='error', story_publish_state='needs_reconciliation',
        story_error='Expired lease after a Story create/publish request began; external result requires manual reconciliation',
        story_claim_token=null, story_lease_until=null, story_action_kind=null, story_action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='story'; outcome:='needs_reconciliation'; return next;
    else
      update dmflow.scheduled_reels q set story_status='pending', story_publish_state='pending', story_error=null,
        story_claim_token=null, story_lease_until=null, story_action_kind=null, story_action_started_at=null
      where q.id=v_row.id;
      scheduled_reel_id:=v_row.id; lane:='story'; outcome:='reclaimed_safe_poll'; return next;
    end if;
  end loop;
  for v_row in select q.id from dmflow.scheduled_reels q
      where q.metadata_status='processing' and q.metadata_lease_until <= p_now
      order by q.metadata_lease_until for update of q skip locked loop
    update dmflow.scheduled_reels q set metadata_status='pending', metadata_claim_token=null,
      metadata_lease_until=null, metadata_action_started_at=null
    where q.id=v_row.id;
    scheduled_reel_id:=v_row.id; lane:='metadata'; outcome:='reclaimed_safe_get'; return next;
  end loop;
  return;
end;
$$;

revoke all on function dmflow.begin_reel_graph_action(uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function dmflow.claim_due_reel_metadata(uuid,timestamptz) from public, anon, authenticated;
revoke all on function dmflow.recover_expired_reel_claims(timestamptz) from public, anon, authenticated;
grant execute on function dmflow.begin_reel_graph_action(uuid,text,text,text,timestamptz) to service_role;
grant execute on function dmflow.claim_due_reel_metadata(uuid,timestamptz) to service_role;
grant execute on function dmflow.recover_expired_reel_claims(timestamptz) to service_role;
