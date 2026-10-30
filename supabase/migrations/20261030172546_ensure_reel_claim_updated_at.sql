-- Legacy scheduled_reels did not have the timestamp written by both claim RPCs.
-- Add the missing field without changing any approval, schedule or lifecycle.
alter table dmflow.scheduled_reels
  add column if not exists updated_at timestamptz not null default now();
