-- Permit a single owner-approved GN Reel while retaining the batch Story contract.
create or replace function dmflow.guard_reel_approval_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  single_reel boolean := new.story_publish_state = 'disabled';
  brt_slot timestamp := to_timestamp(new.scheduled_unix) at time zone 'America/Sao_Paulo';
begin
  if new.account_id is null or new.approved_content_id is null or new.approval_fingerprint is null
     or new.video_sha256 is null or new.video_sha256 !~* '^sha256:[0-9a-f]{64}$'
     or new.cover_sha256 is null or new.cover_sha256 !~* '^sha256:[0-9a-f]{64}$'
     or new.video_url is null or new.cover_url is null or new.caption is null or btrim(new.caption) = ''
     or new.scheduled_unix is null or new.scheduled_unix <= extract(epoch from statement_timestamp())
     or new.canal is null or new.canal not in ('GI','GN') then
    raise exception 'Reel and associated Story require approved assets and fingerprints';
  end if;
  if single_reel and (
       new.canal is distinct from 'GN' or new.idx is distinct from 1
       or extract(isodow from brt_slot) = 7
       or brt_slot::time not in (time '10:00', time '14:00', time '18:00')
       or new.story_url is not null or new.story_sha256 is not null or new.story_approval_fingerprint is not null
       or new.story_approved_content_id is not null or new.story_status is not null
       or new.story_container_status is not null or new.story_permalink is not null or new.story_published_at is not null
     ) then
    raise exception 'GN single Reel requires an approved BRT slot and no Story fields';
  end if;
  if not single_reel and (new.story_url is null or new.story_approved_content_id is null
     or new.story_approval_fingerprint is null or new.story_sha256 is null
     or new.story_sha256 !~* '^sha256:[0-9a-f]{64}$') then
    raise exception 'Associated Story requires approved assets and fingerprint';
  end if;
  -- Serialize origin and media checks against concurrent inserts, including batch callers.
  perform pg_advisory_xact_lock(hashtext('dmflow-reel-queue'), hashtext(new.account_id::text));
  if exists (
    select 1 from dmflow.scheduled_reels q where q.account_id = new.account_id
      and (single_reel or q.story_publish_state = 'disabled')
      and (q.slug = new.slug or lower(q.video_sha256) = lower(new.video_sha256))
  ) then raise exception 'Reel origin or video is already reserved'; end if;
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
      and (not single_reel or a.approved_by = (select owner_user_id from dmflow.accounts where id = new.account_id))
    for share of a
  ) then raise exception 'Reel approval does not match source, account, or fingerprint'; end if;
  if not single_reel and not exists (
    select 1 from dmflow.approved_content a
    where a.id = new.story_approved_content_id and a.content_type = 'reel_story'
      and a.content_id = new.slug || ':' || new.idx::text and a.account_id = new.account_id
      and a.fingerprint = new.story_approval_fingerprint and a.revoked_at is null
  ) then raise exception 'Associated Story approval does not match source, account, or fingerprint'; end if;
  if new.status is distinct from 'pending' or new.publish_state is distinct from 'pending'
     or (not single_reel and new.story_publish_state is distinct from 'pending') or new.claim_token is not null
     or new.story_claim_token is not null or new.post_id is not null or new.story_post_id is not null
     or new.container_id is not null or new.story_container_id is not null then
    raise exception 'New Reel batches must start pending with no Meta receipts';
  end if;
  if not single_reel then new.story_status := 'pending'; end if;
  new.metadata_status := 'pending';
  return new;
end;
$$;
