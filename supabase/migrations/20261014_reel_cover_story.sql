alter table dmflow.scheduled_reels
  add column if not exists cover_url text,
  add column if not exists story_url text,
  add column if not exists story_status text,
  add column if not exists story_container_id text,
  add column if not exists story_post_id text,
  add column if not exists story_published_at timestamptz,
  add column if not exists story_error text;

alter table dmflow.scheduled_reels
  add constraint scheduled_reels_story_status_check
  check (story_status is null or story_status in ('pending', 'processing', 'published', 'error'));
