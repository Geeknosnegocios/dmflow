-- Persist an authoritative publication timestamp with each carousel receipt.
alter table dmflow.scheduled_carousels
  add column if not exists published_at timestamptz;

alter table dmflow.scheduled_carousels
  drop constraint if exists scheduled_carousels_published_receipt_check,
  add constraint scheduled_carousels_published_receipt_check
    check (status <> 'published' or (post_id is not null and published_at is not null));
