-- Run only in the disposable PG17 stack wired by the Supabase schema CI.
begin;
create extension if not exists pgtap;
select plan(43);

select ok(
  (select count(*) = 20 from information_schema.columns
   where table_schema = 'dmflow' and table_name = 'scheduled_reels'
     and column_name = any(array[
       'account_id','video_sha256','cover_sha256','story_sha256','approved_content_id',
       'approval_fingerprint','story_approved_content_id','story_approval_fingerprint',
       'publish_state','story_publish_state','container_status','story_container_status',
       'claim_token','lease_until','publish_claimed_at','story_claim_token','story_lease_until',
       'story_claimed_at','published_at','story_permalink'
     ])),
  'Reel and Story lanes have separate immutable approval, receipt, claim, and time fields'
);
select ok(to_regprocedure('dmflow.claim_due_reel(uuid,text,timestamp with time zone)') is not null,
  'atomic Reel claim function exists');
select ok(to_regprocedure('dmflow.claim_due_reel_story(uuid,text,timestamp with time zone)') is not null,
  'atomic Story claim function exists');
select ok(has_function_privilege('service_role','dmflow.claim_due_reel(uuid,text,timestamp with time zone)','EXECUTE')
  and not has_function_privilege('authenticated','dmflow.claim_due_reel(uuid,text,timestamp with time zone)','EXECUTE'),
  'only service role can claim Reels');
select ok(has_function_privilege('service_role','dmflow.claim_due_reel_story(uuid,text,timestamp with time zone)','EXECUTE')
  and not has_function_privilege('authenticated','dmflow.claim_due_reel_story(uuid,text,timestamp with time zone)','EXECUTE'),
  'only service role can claim associated Stories');
select ok(has_table_privilege('service_role','dmflow.scheduled_reels','UPDATE')
  and not has_table_privilege('authenticated','dmflow.scheduled_reels','INSERT'),
  'queue writes remain private to trusted workers');
select ok(
  exists(select 1 from pg_trigger where tgrelid='dmflow.scheduled_reels'::regclass
    and tgname='scheduled_reels_require_approval' and not tgisinternal),
  'legacy API inserts are blocked unless both media packages have approvals'
);
select ok(
  exists(select 1 from pg_trigger where tgrelid='dmflow.scheduled_reels'::regclass
    and tgname='scheduled_reels_approval_immutable' and not tgisinternal),
  'approved Reel and Story payload fields cannot be mutated after insertion'
);
select ok(
  exists(select 1 from pg_constraint where conrelid='dmflow.scheduled_reels'::regclass
    and conname='scheduled_reels_publish_state_check')
  and exists(select 1 from pg_constraint where conrelid='dmflow.scheduled_reels'::regclass
    and conname='scheduled_reels_story_publish_state_check'),
  'both lanes constrain ambiguity to explicit needs_reconciliation'
);
select ok(
  exists(select 1 from pg_index where indrelid='dmflow.scheduled_reels'::regclass and indisunique
    and pg_get_indexdef(indexrelid) ilike '%(slug, idx)%'),
  'Reelsflow source/cut uniqueness remains (slug, idx)'
);
select ok(
  position('America/Sao_Paulo' in pg_get_functiondef('dmflow.claim_due_reel(uuid,text,timestamp with time zone)'::regprocedure)) > 0
  and position('pg_advisory_xact_lock' in pg_get_functiondef('dmflow.claim_due_reel(uuid,text,timestamp with time zone)'::regprocedure)) > 0,
  'Reel daily cap is serialized on the BRT date'
);
select ok(
  position('>= 3' in pg_get_functiondef('dmflow.claim_due_reel(uuid,text,timestamp with time zone)'::regprocedure)) > 0
  and position('>= 3' in pg_get_functiondef('dmflow.claim_due_reel_story(uuid,text,timestamp with time zone)'::regprocedure)) > 0,
  'Reel and associated Story lanes enforce separate three-per-day caps'
);
select ok(
  position('needs_reconciliation' in pg_get_functiondef('dmflow.guard_reel_approval_update()'::regprocedure)) > 0,
  'ambiguous Graph results cannot be reset by normal queue updates'
);
select ok(
  not has_function_privilege('anon','dmflow.claim_due_reel(uuid,text,timestamp with time zone)','EXECUTE')
  and not has_function_privilege('anon','dmflow.claim_due_reel_story(uuid,text,timestamp with time zone)','EXECUTE'),
  'untrusted roles cannot call publishing claims'
);
select ok(
  position('reel_story' in pg_get_functiondef('dmflow.claim_due_reel_story(uuid,text,timestamp with time zone)'::regprocedure)) > 0
  and position('reel' in pg_get_functiondef('dmflow.claim_due_reel_story(uuid,text,timestamp with time zone)'::regprocedure)) > 0,
  'Story claim requires independent Story and parent Reel approvals'
);

select ok(to_regprocedure('dmflow.resolve_reel_publication(uuid,text,text,uuid,text,text,timestamp with time zone,boolean,text)') is not null,
  'manual Reel and Story reconciliation RPC exists');
select ok((select p.prosecdef from pg_proc p where p.oid =
  'dmflow.resolve_reel_publication(uuid,text,text,uuid,text,text,timestamp with time zone,boolean,text)'::regprocedure),
  'reconciliation RPC executes with a fixed SECURITY DEFINER boundary');
select ok(
  has_function_privilege('service_role','dmflow.resolve_reel_publication(uuid,text,text,uuid,text,text,timestamp with time zone,boolean,text)','EXECUTE')
  and not has_function_privilege('anon','dmflow.resolve_reel_publication(uuid,text,text,uuid,text,text,timestamp with time zone,boolean,text)','EXECUTE')
  and not has_function_privilege('authenticated','dmflow.resolve_reel_publication(uuid,text,text,uuid,text,text,timestamp with time zone,boolean,text)','EXECUTE'),
  'only service role can invoke operator reconciliation'
);
select ok(
  (select relrowsecurity from pg_class where oid='dmflow.instagram_reel_reconciliation_events'::regclass)
  and (select relrowsecurity from pg_class where oid='dmflow.instagram_reel_reconciliation_permits'::regclass),
  'reconciliation history and one-transaction permits are private'
);
select ok(has_table_privilege('service_role','dmflow.instagram_reel_reconciliation_events','SELECT')
  and not has_table_privilege('service_role','dmflow.instagram_reel_reconciliation_events','UPDATE')
  and not has_table_privilege('service_role','dmflow.instagram_reel_reconciliation_events','DELETE'),
  'operators can read but cannot rewrite or delete reconciliation history'
);
select ok(not has_table_privilege('service_role','dmflow.instagram_reel_reconciliation_permits','SELECT')
  and not has_table_privilege('service_role','dmflow.instagram_reel_reconciliation_permits','INSERT'),
  'permit records are writable only inside the definer RPC and trigger transaction'
);
select ok(exists(select 1 from pg_trigger where tgrelid='dmflow.instagram_reel_reconciliation_events'::regclass
  and tgname='reel_reconciliation_event_immutable' and not tgisinternal),
  'audit records reject update and delete mutations');
select ok(position('instagram_reel_reconciliation_permits' in
  pg_get_functiondef('dmflow.guard_reel_approval_update()'::regprocedure)) > 0,
  'terminal state changes require a matching private transaction permit');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000102', 'reel-owner@example.invalid'),
  ('00000000-0000-0000-0000-000000000103', 'other-operator@example.invalid');
insert into dmflow.accounts (id, owner_user_id, active, ig_username, ig_business_id) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', true,
   'andreyogeek', '17890000000000001');
insert into dmflow.approved_content (id, content_type, content_id, account_id, fingerprint, approved_by) values
  ('00000000-0000-0000-0000-000000000111', 'reel', 'RECON-REEL:1', '00000000-0000-0000-0000-000000000101', 'sha256:' || repeat('1',64), '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000112', 'reel_story', 'RECON-REEL:1', '00000000-0000-0000-0000-000000000101', 'sha256:' || repeat('2',64), '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000113', 'reel', 'RECON-STORY:2', '00000000-0000-0000-0000-000000000101', 'sha256:' || repeat('3',64), '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000114', 'reel_story', 'RECON-STORY:2', '00000000-0000-0000-0000-000000000101', 'sha256:' || repeat('4',64), '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000115', 'reel', 'RECON-ERROR:3', '00000000-0000-0000-0000-000000000101', 'sha256:' || repeat('5',64), '00000000-0000-0000-0000-000000000102'),
  ('00000000-0000-0000-0000-000000000116', 'reel_story', 'RECON-ERROR:3', '00000000-0000-0000-0000-000000000101', 'sha256:' || repeat('6',64), '00000000-0000-0000-0000-000000000102');

select lives_ok($sql$
  insert into dmflow.scheduled_reels (
    id, slug, idx, account_id, video_url, video_sha256, cover_url, cover_sha256, story_url, story_sha256,
    caption, canal, scheduled_unix, status, publish_state, story_publish_state,
    approved_content_id, approval_fingerprint, story_approved_content_id, story_approval_fingerprint
  ) values
    ('00000000-0000-0000-0000-000000000121','RECON-REEL',1,'00000000-0000-0000-0000-000000000101',
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/reel1.mp4','sha256:'||repeat('a',64),
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/cover1.jpg','sha256:'||repeat('b',64),
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/story1.mp4','sha256:'||repeat('c',64),
     'approved Reel 1','GI',extract(epoch from statement_timestamp())::bigint+86400,'pending','pending','pending',
     '00000000-0000-0000-0000-000000000111','sha256:'||repeat('1',64),
     '00000000-0000-0000-0000-000000000112','sha256:'||repeat('2',64)),
    ('00000000-0000-0000-0000-000000000122','RECON-STORY',2,'00000000-0000-0000-0000-000000000101',
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/reel2.mp4','sha256:'||repeat('d',64),
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/cover2.jpg','sha256:'||repeat('e',64),
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/story2.mp4','sha256:'||repeat('f',64),
     'approved Reel 2','GI',extract(epoch from statement_timestamp())::bigint+86460,'pending','pending','pending',
     '00000000-0000-0000-0000-000000000113','sha256:'||repeat('3',64),
     '00000000-0000-0000-0000-000000000114','sha256:'||repeat('4',64)),
    ('00000000-0000-0000-0000-000000000123','RECON-ERROR',3,'00000000-0000-0000-0000-000000000101',
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/reel3.mp4','sha256:'||repeat('7',64),
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/cover3.jpg','sha256:'||repeat('8',64),
     'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/story3.mp4','sha256:'||repeat('9',64),
     'approved Reel 3','GI',extract(epoch from statement_timestamp())::bigint+86520,'pending','pending','pending',
     '00000000-0000-0000-0000-000000000115','sha256:'||repeat('5',64),
     '00000000-0000-0000-0000-000000000116','sha256:'||repeat('6',64));
$sql$, 'approved Reel test rows can be staged before publication');

select throws_ok($sql$
  update dmflow.scheduled_reels set status='published', publish_state='published', post_id='unverified-reel'
  where id='00000000-0000-0000-0000-000000000123'
$sql$, 'P0001', 'Reel publication requires a claimed operation or verified reconciliation',
  'direct pending-to-published Reel transition is rejected');
select throws_ok($sql$
  update dmflow.scheduled_reels set story_status='published', story_publish_state='published', story_post_id='unverified-story'
  where id='00000000-0000-0000-0000-000000000122'
$sql$, 'P0001', 'Story publication requires a claimed operation or verified reconciliation',
  'direct pending-to-published Story transition is rejected');

update dmflow.scheduled_reels set status='error', publish_state='needs_reconciliation', error='ambiguous Meta response'
 where id='00000000-0000-0000-0000-000000000121';
update dmflow.scheduled_reels set status='processing', publish_state='processing'
 where id='00000000-0000-0000-0000-000000000122';
update dmflow.scheduled_reels set status='published', publish_state='published', post_id='parent-reel-post',
    published_at=statement_timestamp(), permalink='https://www.instagram.com/reel/parent-post/'
 where id='00000000-0000-0000-0000-000000000122';
update dmflow.scheduled_reels set story_status='error', story_publish_state='needs_reconciliation', story_error='ambiguous Story response'
 where id='00000000-0000-0000-0000-000000000122';
update dmflow.scheduled_reels set status='error', publish_state='needs_reconciliation', error='ambiguous Meta response'
 where id='00000000-0000-0000-0000-000000000123';

set local role service_role;
select throws_ok($sql$
  select dmflow.resolve_reel_publication('00000000-0000-0000-0000-000000000121','reel','published',
    '00000000-0000-0000-0000-000000000102',null,null,null,false,'verified on profile')
$sql$, 'P0001', 'Published resolution requires external post id, permalink, and publish time',
  'missing external publication proof is rejected');
select throws_ok($sql$
  select dmflow.resolve_reel_publication('00000000-0000-0000-0000-000000000121','reel','published',
    '00000000-0000-0000-0000-000000000103','reconciled-reel','https://www.instagram.com/reel/reconciled-reel/',statement_timestamp(),false,'verified')
$sql$, 'P0001', 'Only the owning account operator can resolve this queue item',
  'non-owner cannot resolve a publishing receipt');
select throws_ok($sql$
  update dmflow.scheduled_reels set status='published', publish_state='published', post_id='forged'
  where id='00000000-0000-0000-0000-000000000121'
$sql$, 'P0001', 'Reel terminal state can only be resolved with external proof through the reconciliation RPC',
  'direct service-role update cannot resolve ambiguous Reel state');
select throws_ok($sql$
  select dmflow.resolve_reel_publication('00000000-0000-0000-0000-000000000123','reel','error',
    '00000000-0000-0000-0000-000000000102',null,null,null,false,'No post was found')
$sql$, 'P0001', 'Error resolution requires explicit no-post confirmation and no post receipt',
  'error resolution rejects missing no-post confirmation');
select ok(dmflow.resolve_reel_publication('00000000-0000-0000-0000-000000000121','reel','published',
    '00000000-0000-0000-0000-000000000102','reconciled-reel-1',
    'https://www.instagram.com/reel/reconciled-reel-1/',statement_timestamp(),false,'Verified external Meta receipt') is not null,
  'owner can resolve Reel as published with external ID, permalink and time');
select is((select post_id from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000121'),
  'reconciled-reel-1'::text, 'Reel reconciliation saves the exact external ID');
select is((select publish_state from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000121'),
  'published'::text, 'Reel reconciliation resolves only the Reel lane');
select ok(dmflow.resolve_reel_publication('00000000-0000-0000-0000-000000000122','story','published',
    '00000000-0000-0000-0000-000000000102','reconciled-story-2',
    'https://www.instagram.com/stories/andreyogeek/reconciled-story-2/',statement_timestamp(),false,'Verified Story receipt') is not null,
  'owner can resolve associated Story as published after its Reel');
select is((select post_id from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000122'),
  'parent-reel-post'::text, 'Story resolution preserves its parent Reel receipt');
select is((select story_post_id from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000122'),
  'reconciled-story-2'::text, 'Story resolution stores an independent external Story ID');
select ok(dmflow.resolve_reel_publication('00000000-0000-0000-0000-000000000123','reel','error',
    '00000000-0000-0000-0000-000000000102',null,null,null,true,'Confirmed in profile and Graph: no post exists') is not null,
  'owner can resolve a Reel as error only after explicit no-post confirmation');
select is((select publish_state from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000123'),
  'error'::text, 'confirmed no-post resolution leaves Reel terminal in error');
select throws_ok($sql$
  update dmflow.scheduled_reels set status='pending', publish_state='pending'
  where id='00000000-0000-0000-0000-000000000123'
$sql$, 'P0001', 'Reel terminal state can only be resolved with external proof through the reconciliation RPC',
  'confirmed no-post Reel cannot be requeued');
select throws_ok($sql$
  update dmflow.scheduled_reels set story_status='pending', story_publish_state='pending'
  where id='00000000-0000-0000-0000-000000000122'
$sql$, 'P0001', 'Story terminal state can only be resolved with external proof through the reconciliation RPC',
  'resolved Story cannot be requeued');
select is((select count(*)::integer from dmflow.instagram_reel_reconciliation_events), 3,
  'each manual resolution produces exactly one immutable audit event');
select ok((select count(*)=3 and bool_and(operator_user_id='00000000-0000-0000-0000-000000000102')
  from dmflow.instagram_reel_reconciliation_events),
  'audit events retain the verified owner and one evidence record per lane');
select ok(exists(select 1 from dmflow.instagram_reel_reconciliation_events
  where scheduled_reel_id='00000000-0000-0000-0000-000000000121' and lane='reel' and outcome='published'
    and external_post_id='reconciled-reel-1'
    and permalink='https://www.instagram.com/reel/reconciled-reel-1/' and published_at is not null
    and confirmed_no_post is false),
  'published audit stores exact Meta ID, permalink, time, and outcome');
reset role;

select * from finish();
rollback;

