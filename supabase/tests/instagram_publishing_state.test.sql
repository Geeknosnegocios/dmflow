-- Run only in the disposable local Supabase/Postgres stack created by
-- .github/workflows/supabase-schema.yml (`supabase test db`). Never link this
-- test to the Geek Academy project or run it against production.
begin;
create extension if not exists pgtap;
select plan(34);

select ok(to_regnamespace('dmflow') is not null, 'private dmflow schema exists');
select ok(to_regclass('dmflow.scheduled_carousels') is not null, 'carousel queue exists');
select ok(
  (select count(*) = 18 from information_schema.columns
   where table_schema = 'dmflow' and table_name = 'scheduled_carousels'
     and column_name = any(array[
       'card_id', 'account_id', 'canal', 'caption', 'image_urls', 'approval_fingerprint',
       'publish_at', 'slide_container_ids', 'slide_statuses', 'parent_container_id', 'status',
       'post_id', 'permalink', 'error', 'created_at', 'updated_at', 'claim_token', 'lease_until'
     ])),
  'carousel queue has required content, receipt, claim, and timestamp fields'
);
select ok(
  exists (select 1 from pg_index i join pg_class t on t.oid = i.indrelid
          join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'dmflow' and t.relname = 'scheduled_carousels' and i.indisunique
            and pg_get_indexdef(i.indexrelid) ilike '%(card_id)%'),
  'carousel card ids are unique'
);

select ok(to_regclass('dmflow.approved_content') is not null, 'immutable approval registry exists');
select ok(
  (select count(*) = 7 from information_schema.columns
   where table_schema = 'dmflow' and table_name = 'approved_content'
     and column_name = any(array['content_type','content_id','account_id','fingerprint','approved_by','approved_at','revoked_at'])),
  'approval registry has all required fields'
);
select ok(
  exists (select 1 from pg_index i join pg_class t on t.oid = i.indrelid
          join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'dmflow' and t.relname = 'approved_content' and i.indisunique
            and pg_get_indexdef(i.indexrelid) ilike '%content_type%content_id%fingerprint%'),
  'approval content identity and fingerprint are unique'
);
select ok(
  exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
          join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'dmflow' and t.relname = 'approved_content' and c.contype = 'f'
            and c.confrelid = 'auth.users'::regclass and pg_get_constraintdef(c.oid) ilike '%approved_by%'),
  'approval signer references an authenticated owner identity'
);
select ok(
  exists (select 1 from pg_trigger where tgrelid = 'dmflow.approved_content'::regclass
          and tgname = 'approved_content_immutable' and not tgisinternal),
  'approval mutations are guarded by the immutability trigger'
);
select ok(
  position('owner_user_id' in lower(pg_get_functiondef('dmflow.guard_approved_content_mutation()'::regprocedure))) > 0
  and position('approved_by' in lower(pg_get_functiondef('dmflow.guard_approved_content_mutation()'::regprocedure))) > 0,
  'approval insert verifies the signer against the account owner'
);
select ok(
  has_table_privilege('service_role', 'dmflow.approved_content', 'INSERT')
  and has_column_privilege('service_role', 'dmflow.approved_content', 'revoked_at', 'UPDATE')
  and not has_table_privilege('service_role', 'dmflow.approved_content', 'DELETE')
  and not has_table_privilege('service_role', 'dmflow.approved_content', 'UPDATE'),
  'service role can insert and revoke once, but cannot rewrite or delete approval records'
);

select ok(to_regclass('dmflow.scheduled_reels') is not null, 'existing Reel queue is preserved');
select ok(
  (select count(*) >= 1 from information_schema.columns
   where table_schema = 'dmflow' and table_name = 'scheduled_reels'
     and column_name = any(array['approval_fingerprint','approved_content_id','container_id','claim_token'])),
  'Reel queue has approval or persistent checkpoint metadata'
);
select ok(
  exists (select 1 from pg_index i join pg_class t on t.oid = i.indrelid
          join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'dmflow' and t.relname = 'scheduled_reels' and i.indisunique
            and pg_get_indexdef(i.indexrelid) ilike '%(slug, idx)%')
  and not exists (select 1 from pg_index i join pg_class t on t.oid = i.indrelid
                  join pg_namespace n on n.oid = t.relnamespace
                  where n.nspname = 'dmflow' and t.relname = 'scheduled_reels' and i.indisunique
                    and pg_get_indexdef(i.indexrelid) ilike '%(slug)%'),
  'Reel source/clip identity stays unique as (slug, idx), while multiple clips per source remain valid'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'dmflow.scheduled_carousels'::regclass)
  and (select relrowsecurity from pg_class where oid = 'dmflow.approved_content'::regclass),
  'publishing queue and approval registry have RLS enabled'
);
select ok(not has_table_privilege('anon', 'dmflow.scheduled_carousels', 'SELECT'), 'anon cannot read the private queue');
select ok(not has_table_privilege('authenticated', 'dmflow.scheduled_carousels', 'INSERT'), 'authenticated clients cannot create queue rows');
select ok(not has_table_privilege('authenticated', 'dmflow.approved_content', 'INSERT'), 'authenticated clients cannot self-authorize approvals');
select ok(has_table_privilege('service_role', 'dmflow.scheduled_carousels', 'UPDATE'), 'service role can advance queue state');

select ok(to_regprocedure('dmflow.claim_due_carousels(integer)') is not null, 'atomic due-carousel claim RPC exists');
select ok(has_function_privilege('service_role', 'dmflow.claim_due_carousels(integer)', 'EXECUTE'), 'service role can claim due carousels');
select ok(not has_function_privilege('authenticated', 'dmflow.claim_due_carousels(integer)', 'EXECUTE'), 'authenticated callers cannot claim queue rows');
select ok(
  position('skip locked' in lower(pg_get_functiondef('dmflow.claim_due_carousels(integer)'::regprocedure))) > 0
  and position('scheduled' in lower(pg_get_functiondef('dmflow.claim_due_carousels(integer)'::regprocedure))) > 0
  and position('needs_reconciliation' in lower(pg_get_functiondef('dmflow.claim_due_carousels(integer)'::regprocedure))) = 0,
  'atomic claims lock only scheduled work and never auto-retry needs_reconciliation'
);
select ok(
  exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
          join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'dmflow' and t.relname = 'scheduled_carousels' and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ilike '%draft%'
            and pg_get_constraintdef(c.oid) ilike '%scheduled%'
            and pg_get_constraintdef(c.oid) ilike '%processing%'
            and pg_get_constraintdef(c.oid) ilike '%needs_reconciliation%'
            and pg_get_constraintdef(c.oid) ilike '%published%'
            and pg_get_constraintdef(c.oid) ilike '%error%'
            and pg_get_constraintdef(c.oid) ilike '%paused%'),
  'queue constrains status to the approved lifecycle states'
);

select ok(
  (select count(*) = 2 from information_schema.columns
   where table_schema = 'dmflow' and table_name = 'scheduled_carousels'
     and column_name = any(array['slide_hashes','parent_status'])),
  'carousel queue persists approved slide hashes and parent status'
);
select ok(
  (select count(*) = 2 from pg_attribute a
   where a.attrelid = 'dmflow.scheduled_carousels'::regclass
     and a.attname = any(array['slide_container_ids','slide_statuses'])
     and pg_get_expr((select d.adbin from pg_attrdef d
                      where d.adrelid = a.attrelid and d.adnum = a.attnum), a.attrelid) ilike '%array_fill%')
  and exists (select 1 from pg_attrdef d
              where d.adrelid = 'dmflow.scheduled_carousels'::regclass
                and d.adnum = (select attnum from pg_attribute
                               where attrelid = d.adrelid and attname = 'slide_statuses')
                and pg_get_expr(d.adbin, d.adrelid) ilike '%pending%'),
  'fresh child checkpoints default to eight empty ids and eight PENDING statuses'
);
select ok(
  exists (select 1 from pg_constraint c
          where c.conrelid = 'dmflow.scheduled_carousels'::regclass
            and c.conname = 'scheduled_carousels_eight_slide_check'
            and pg_get_constraintdef(c.oid) ilike '%cardinality(image_urls) = 8%'
            and pg_get_constraintdef(c.oid) ilike '%cardinality(slide_hashes) = 8%'
            and pg_get_constraintdef(c.oid) ilike '%cardinality(slide_container_ids) = 8%'
            and pg_get_constraintdef(c.oid) ilike '%cardinality(slide_statuses) = 8%'),
  'image URLs, slide hashes, and both checkpoint arrays require eight entries'
);
select ok(to_regprocedure('dmflow.claim_carousel_by_card(text,text,timestamp with time zone)') is not null,
  'atomic exact-card carousel claim RPC exists');
select ok(
  has_function_privilege('service_role', 'dmflow.claim_carousel_by_card(text,text,timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('anon', 'dmflow.claim_carousel_by_card(text,text,timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'dmflow.claim_carousel_by_card(text,text,timestamp with time zone)', 'EXECUTE'),
  'only the service role can execute the exact-card claim RPC'
);
select ok(
  position('approval.content_type = ''carousel''' in lower(pg_get_functiondef('dmflow.claim_carousel_by_card(text,text,timestamp with time zone)'::regprocedure))) > 0
  and position('approval.content_id = q.card_id' in lower(pg_get_functiondef('dmflow.claim_carousel_by_card(text,text,timestamp with time zone)'::regprocedure))) > 0
  and position('approval.account_id = q.account_id' in lower(pg_get_functiondef('dmflow.claim_carousel_by_card(text,text,timestamp with time zone)'::regprocedure))) > 0
  and position('approval.fingerprint = p_fingerprint' in lower(pg_get_functiondef('dmflow.claim_carousel_by_card(text,text,timestamp with time zone)'::regprocedure))) > 0
  and position('approval.revoked_at is null' in lower(pg_get_functiondef('dmflow.claim_carousel_by_card(text,text,timestamp with time zone)'::regprocedure))) > 0,
  'claim requires matching carousel type, card, account, fingerprint, and unrevoked approval'
);

-- Minimal disposable identity fixture for runtime claim behavior assertions.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000002', 'carousel-pgtap@example.invalid');
insert into dmflow.accounts (id, owner_user_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

insert into dmflow.scheduled_carousels (
  card_id, account_id, canal, caption, image_urls, slide_hashes, approval_fingerprint, publish_at
) values (
  'CARD-DEFAULT', '00000000-0000-0000-0000-000000000001', 'instagram', 'fixture caption',
  array['https://storage.invalid/1.png','https://storage.invalid/2.png','https://storage.invalid/3.png','https://storage.invalid/4.png',
        'https://storage.invalid/5.png','https://storage.invalid/6.png','https://storage.invalid/7.png','https://storage.invalid/8.png'],
  array['h1','h2','h3','h4','h5','h6','h7','h8'], 'fp-default', '2026-10-29 12:06:00+00'
);
select is(
  (select cardinality(slide_container_ids) = 8
          and slide_container_ids = array_fill(null::text, array[8])
          and cardinality(slide_statuses) = 8
          and slide_statuses = array_fill('PENDING'::text, array[8])
   from dmflow.scheduled_carousels where card_id = 'CARD-DEFAULT'),
  true,
  'new queue rows receive eight empty container slots and eight PENDING statuses'
);

insert into dmflow.approved_content (content_type, content_id, account_id, fingerprint, approved_by) values
  ('carousel', 'CARD-LIVE', '00000000-0000-0000-0000-000000000001', 'fp-live', '00000000-0000-0000-0000-000000000002'),
  ('carousel', 'CARD-REVOKED', '00000000-0000-0000-0000-000000000001', 'fp-revoked', '00000000-0000-0000-0000-000000000002');
update dmflow.approved_content set revoked_at = statement_timestamp() where content_id = 'CARD-REVOKED';
insert into dmflow.scheduled_carousels (
  card_id, account_id, canal, caption, image_urls, slide_hashes, approval_fingerprint, publish_at, status
) values
  ('CARD-LIVE', '00000000-0000-0000-0000-000000000001', 'instagram', 'fixture caption',
   array['https://storage.invalid/1.png','https://storage.invalid/2.png','https://storage.invalid/3.png','https://storage.invalid/4.png',
         'https://storage.invalid/5.png','https://storage.invalid/6.png','https://storage.invalid/7.png','https://storage.invalid/8.png'],
   array['h1','h2','h3','h4','h5','h6','h7','h8'], 'fp-live', '2026-10-29 13:06:00+00', 'scheduled'),
  ('CARD-MISSING', '00000000-0000-0000-0000-000000000001', 'instagram', 'fixture caption',
   array['https://storage.invalid/1.png','https://storage.invalid/2.png','https://storage.invalid/3.png','https://storage.invalid/4.png',
         'https://storage.invalid/5.png','https://storage.invalid/6.png','https://storage.invalid/7.png','https://storage.invalid/8.png'],
   array['h1','h2','h3','h4','h5','h6','h7','h8'], 'fp-missing', '2026-10-29 14:06:00+00', 'scheduled'),
  ('CARD-REVOKED', '00000000-0000-0000-0000-000000000001', 'instagram', 'fixture caption',
   array['https://storage.invalid/1.png','https://storage.invalid/2.png','https://storage.invalid/3.png','https://storage.invalid/4.png',
         'https://storage.invalid/5.png','https://storage.invalid/6.png','https://storage.invalid/7.png','https://storage.invalid/8.png'],
   array['h1','h2','h3','h4','h5','h6','h7','h8'], 'fp-revoked', '2026-10-29 15:06:00+00', 'scheduled');
select is((select count(*)::integer from dmflow.claim_carousel_by_card('CARD-LIVE', 'fp-live', '2030-01-01 00:00:00+00')), 1,
  'claim succeeds for the exact card and active matching approval');
select is((select count(*)::integer from dmflow.claim_carousel_by_card('CARD-MISSING', 'fp-missing', '2030-01-01 00:00:00+00')), 0,
  'claim returns no row when the approval is missing');
select is((select count(*)::integer from dmflow.claim_carousel_by_card('CARD-REVOKED', 'fp-revoked', '2030-01-01 00:00:00+00')), 0,
  'claim returns no row when the approval is revoked');

select * from finish();
rollback;
