alter table dmflow.scheduled_carousels
  add column if not exists slide_hashes text[] not null default array_fill(null::text, array[8]),
  add column if not exists parent_status text;

alter table dmflow.scheduled_carousels
  alter column slide_container_ids set default array_fill(null::text, array[8]),
  alter column slide_statuses set default array_fill('PENDING'::text, array[8]);

update dmflow.scheduled_carousels as q
set slide_container_ids = array(
      select case when position <= coalesce(cardinality(q.slide_container_ids), 0)
        then q.slide_container_ids[position] else null::text end
      from generate_series(1, 8) as slots(position)
      order by slots.position
    ),
    slide_statuses = array(
      select case when position <= coalesce(cardinality(q.slide_statuses), 0)
        then q.slide_statuses[position] else 'PENDING'::text end
      from generate_series(1, 8) as slots(position)
      order by slots.position
    )
where cardinality(q.slide_container_ids) is distinct from 8
   or cardinality(q.slide_statuses) is distinct from 8;

do $$
begin
  if exists (
    select 1 from dmflow.scheduled_carousels
    where cardinality(image_urls) is distinct from 8
       or cardinality(slide_hashes) is distinct from 8
  ) then
    raise exception 'scheduled carousels must have exactly eight image URLs and slide hashes before migration';
  end if;
end;
$$;

alter table dmflow.scheduled_carousels
  drop constraint if exists scheduled_carousels_eight_slide_check;
alter table dmflow.scheduled_carousels
  add constraint scheduled_carousels_eight_slide_check check (
    cardinality(image_urls) = 8 and array_position(image_urls, null::text) is null
    and cardinality(slide_hashes) = 8 and array_position(slide_hashes, null::text) is null
    and cardinality(slide_container_ids) = 8 and cardinality(slide_statuses) = 8
  );

create or replace function dmflow.claim_carousel_by_card(
  p_card_id text,
  p_fingerprint text,
  p_now timestamptz
)
returns setof dmflow.scheduled_carousels
language sql
security invoker
set search_path = ''
as $$
  update dmflow.scheduled_carousels as q
  set status = 'processing',
      claim_token = gen_random_uuid()::text,
      lease_until = statement_timestamp() + interval '5 minutes',
      updated_at = statement_timestamp()
  where q.card_id = p_card_id
    and q.approval_fingerprint = p_fingerprint
    and q.status = 'scheduled'
    and q.publish_at <= p_now
    and exists (
      select 1
      from dmflow.approved_content as approval
      where approval.content_type = 'carousel'
        and approval.content_id = q.card_id
        and approval.account_id = q.account_id
        and approval.fingerprint = p_fingerprint
        and approval.revoked_at is null
    )
  returning q.*;
$$;

revoke all on function dmflow.claim_carousel_by_card(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function dmflow.claim_carousel_by_card(text, text, timestamptz)
  to service_role;
