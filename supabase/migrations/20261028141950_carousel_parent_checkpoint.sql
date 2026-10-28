alter table dmflow.scheduled_carousels
  add column if not exists parent_status text;

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
  returning q.*;
$$;

revoke all on function dmflow.claim_carousel_by_card(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function dmflow.claim_carousel_by_card(text, text, timestamptz)
  to service_role;
