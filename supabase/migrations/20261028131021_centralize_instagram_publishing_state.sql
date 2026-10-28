-- Centralize Instagram publishing state in a private schema. Queue rows are
-- created and advanced only by trusted server-side workers.
create schema if not exists dmflow;

grant usage on schema dmflow to service_role;

create table if not exists dmflow.approved_content (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id text not null,
  account_id uuid not null references dmflow.accounts(id),
  fingerprint text not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (content_type, content_id, fingerprint)
);

create or replace function dmflow.guard_approved_content_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'approved content records cannot be deleted';
  elsif tg_op = 'INSERT' then
    if not exists (
      select 1
      from dmflow.accounts as a
      where a.id = new.account_id
        and a.owner_user_id = new.approved_by
    ) then
      raise exception 'approval signer must own the referenced account';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.revoked_at is not null
       or new.revoked_at is null
       or (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') then
      raise exception 'approved content may only be revoked once';
    end if;
    return new;
  end if;
  raise exception 'unsupported approved content mutation';
end;
$$;

revoke all on function dmflow.guard_approved_content_mutation() from public, anon, authenticated;

drop trigger if exists approved_content_immutable on dmflow.approved_content;
create trigger approved_content_immutable
before insert or update or delete on dmflow.approved_content
for each row execute function dmflow.guard_approved_content_mutation();

create table if not exists dmflow.scheduled_carousels (
  id uuid primary key default gen_random_uuid(),
  card_id text not null unique,
  account_id uuid not null references dmflow.accounts(id),
  canal text not null,
  caption text not null,
  image_urls text[] not null,
  approval_fingerprint text not null,
  publish_at timestamptz not null,
  slide_container_ids text[] not null default '{}',
  slide_statuses text[] not null default '{}',
  parent_container_id text,
  status text not null default 'draft',
  post_id text,
  permalink text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claim_token text,
  lease_until timestamptz,
  constraint scheduled_carousels_status_check
    check (status in ('draft', 'scheduled', 'processing', 'needs_reconciliation', 'published', 'error', 'paused'))
);

-- Add durable approval/checkpoint metadata to the existing Reel queue.
alter table dmflow.scheduled_reels
  add column if not exists approval_fingerprint text,
  add column if not exists approved_content_id uuid references dmflow.approved_content(id),
  add column if not exists container_id text,
  add column if not exists claim_token text;

-- Preserve the production per-cut identity. Add the composite key only when
-- the legacy table does not already have an equivalent unique index/constraint.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'dmflow.scheduled_reels'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%(slug, idx)%'
  ) then
    create unique index scheduled_reels_slug_idx_unique
      on dmflow.scheduled_reels (slug, idx);
  end if;
end;
$$;

alter table dmflow.approved_content enable row level security;
alter table dmflow.scheduled_carousels enable row level security;

revoke all on dmflow.approved_content from public, anon, authenticated, service_role;
revoke all on dmflow.scheduled_carousels from public, anon, authenticated;
grant select, insert on dmflow.approved_content to service_role;
grant update (revoked_at) on dmflow.approved_content to service_role;
grant select, insert, update, delete on dmflow.scheduled_carousels to service_role;

create or replace function dmflow.claim_due_carousels(p_limit integer)
returns setof dmflow.scheduled_carousels
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select q.id
    from dmflow.scheduled_carousels as q
    where q.status = 'scheduled'
      and q.publish_at <= statement_timestamp()
    order by q.publish_at, q.id
    limit greatest(coalesce(p_limit, 0), 0)
    for update of q skip locked
  )
  update dmflow.scheduled_carousels as q
  set status = 'processing',
      claim_token = gen_random_uuid()::text,
      lease_until = statement_timestamp() + interval '5 minutes',
      updated_at = statement_timestamp()
  from due
  where q.id = due.id
  returning q.*;
$$;

revoke all on function dmflow.claim_due_carousels(integer) from public, anon, authenticated;
grant execute on function dmflow.claim_due_carousels(integer) to service_role;
