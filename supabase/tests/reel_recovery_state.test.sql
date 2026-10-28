-- Runs after the Reel publisher migrations in disposable PG17 schema CI only.
begin;
create extension if not exists pgtap;
select plan(22);

select ok((
  select count(*) = 10 from information_schema.columns
  where table_schema='dmflow' and table_name='scheduled_reels'
    and column_name=any(array['action_kind','action_started_at','story_action_kind','story_action_started_at',
      'metadata_status','metadata_claim_token','metadata_lease_until','metadata_claimed_at',
      'metadata_action_started_at','provider_published_at'])
), 'Reel, Story and metadata operations have separate durable phase/receipt columns');
select ok(to_regprocedure('dmflow.begin_reel_graph_action(uuid,text,text,text,timestamptz)') is not null,
  'Graph call phase must be atomically marked before making the request');
select ok(to_regprocedure('dmflow.claim_due_reel_metadata(uuid,timestamptz)') is not null,
  'published Reel permalink lookup has an independent claim');
select ok(to_regprocedure('dmflow.recover_expired_reel_claims(timestamptz)') is not null,
  'expired publishing and metadata leases have an explicit recovery transition');
select ok(has_function_privilege('service_role','dmflow.begin_reel_graph_action(uuid,text,text,text,timestamptz)','EXECUTE')
  and has_function_privilege('service_role','dmflow.recover_expired_reel_claims(timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','dmflow.recover_expired_reel_claims(timestamptz)','EXECUTE'),
  'only trusted service role can change external-operation phases or recover expired claims');
select ok(position('needs_reconciliation' in pg_get_functiondef(
    'dmflow.recover_expired_reel_claims(timestamptz)'::regprocedure))>0
  and position('reclaimed_safe_poll' in pg_get_functiondef(
    'dmflow.recover_expired_reel_claims(timestamptz)'::regprocedure))>0,
  'expired Graph writes reconcile, while only safe read phases return to pending');
select ok(position('reclaimed_safe_get' in pg_get_functiondef(
    'dmflow.recover_expired_reel_claims(timestamptz)'::regprocedure))>0,
  'metadata GET leases are safe to retry without a media_publish call');

insert into auth.users (id,email) values
  ('00000000-0000-0000-0000-000000000202','recovery-owner@example.invalid');
insert into dmflow.accounts (id,owner_user_id,active,ig_username,ig_business_id) values
  ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202',true,
   'andreyogeek','17890000000000002');
insert into dmflow.approved_content (id,content_type,content_id,account_id,fingerprint,approved_by) values
  ('00000000-0000-0000-0000-000000000211','reel','RECOVERY-A:1','00000000-0000-0000-0000-000000000201','sha256:'||repeat('1',64),'00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000212','reel_story','RECOVERY-A:1','00000000-0000-0000-0000-000000000201','sha256:'||repeat('2',64),'00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000213','reel','RECOVERY-B:2','00000000-0000-0000-0000-000000000201','sha256:'||repeat('3',64),'00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000214','reel_story','RECOVERY-B:2','00000000-0000-0000-0000-000000000201','sha256:'||repeat('4',64),'00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000215','reel','RECOVERY-C:3','00000000-0000-0000-0000-000000000201','sha256:'||repeat('5',64),'00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000216','reel_story','RECOVERY-C:3','00000000-0000-0000-0000-000000000201','sha256:'||repeat('6',64),'00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000217','reel','RECOVERY-D:1','00000000-0000-0000-0000-000000000201','sha256:'||repeat('7',64),'00000000-0000-0000-0000-000000000202'),
  ('00000000-0000-0000-0000-000000000218','reel_story','RECOVERY-D:1','00000000-0000-0000-0000-000000000201','sha256:'||repeat('8',64),'00000000-0000-0000-0000-000000000202');

insert into dmflow.scheduled_reels (
  id,slug,idx,account_id,canal,video_url,video_sha256,cover_url,cover_sha256,story_url,story_sha256,
  caption,scheduled_unix,status,publish_state,story_publish_state,approved_content_id,approval_fingerprint,
  story_approved_content_id,story_approval_fingerprint
) values
 ('00000000-0000-0000-0000-000000000301','RECOVERY-A',1,'00000000-0000-0000-0000-000000000201','GI',
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/a.mp4','sha256:'||repeat('a',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/a.jpg','sha256:'||repeat('b',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/as.mp4','sha256:'||repeat('c',64),
  'Recovery Reel A',extract(epoch from statement_timestamp()+interval '2 days')::bigint,'pending','pending','pending',
  '00000000-0000-0000-0000-000000000211','sha256:'||repeat('1',64),'00000000-0000-0000-0000-000000000212','sha256:'||repeat('2',64)),
 ('00000000-0000-0000-0000-000000000302','RECOVERY-B',2,'00000000-0000-0000-0000-000000000201','GI',
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/b.mp4','sha256:'||repeat('d',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/b.jpg','sha256:'||repeat('e',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/bs.mp4','sha256:'||repeat('f',64),
  'Recovery Reel B',extract(epoch from statement_timestamp()+interval '2 days 4 hours')::bigint,'pending','pending','pending',
  '00000000-0000-0000-0000-000000000213','sha256:'||repeat('3',64),'00000000-0000-0000-0000-000000000214','sha256:'||repeat('4',64)),
 ('00000000-0000-0000-0000-000000000303','RECOVERY-C',3,'00000000-0000-0000-0000-000000000201','GI',
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/c.mp4','sha256:'||repeat('7',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/c.jpg','sha256:'||repeat('8',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/cs.mp4','sha256:'||repeat('9',64),
  'Recovery Reel C',extract(epoch from statement_timestamp()+interval '2 days 8 hours')::bigint,'pending','pending','pending',
  '00000000-0000-0000-0000-000000000215','sha256:'||repeat('5',64),'00000000-0000-0000-0000-000000000216','sha256:'||repeat('6',64)),
 ('00000000-0000-0000-0000-000000000304','RECOVERY-D',1,'00000000-0000-0000-0000-000000000201','GN',
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/d.mp4','sha256:'||repeat('a',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/d.jpg','sha256:'||repeat('b',64),
  'https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/ds.mp4','sha256:'||repeat('c',64),
  'Recovery Reel D',extract(epoch from statement_timestamp()+interval '3 days')::bigint,'pending','pending','pending',
  '00000000-0000-0000-0000-000000000217','sha256:'||repeat('7',64),'00000000-0000-0000-0000-000000000218','sha256:'||repeat('8',64));

select lives_ok($sql$
  update dmflow.scheduled_reels set status='processing',publish_state='processing',claim_token='lease-a',lease_until=statement_timestamp()+interval '5 minutes'
    where id='00000000-0000-0000-0000-000000000301';
  update dmflow.scheduled_reels set status='processing',publish_state='processing',claim_token='lease-b',lease_until=statement_timestamp()+interval '5 minutes',container_id='container-b',container_status='IN_PROGRESS'
    where id='00000000-0000-0000-0000-000000000302';
  update dmflow.scheduled_reels set status='processing',publish_state='processing',claim_token='lease-c',lease_until=statement_timestamp()+interval '5 minutes',container_id='container-c',container_status='FINISHED'
    where id='00000000-0000-0000-0000-000000000303';
  update dmflow.scheduled_reels set status='published',publish_state='published',post_id='parent-d',published_at=statement_timestamp(),permalink='https://www.instagram.com/reel/parent-d/'
    where id='00000000-0000-0000-0000-000000000303';
  update dmflow.scheduled_reels set story_status='processing',story_publish_state='processing',story_claim_token='story-lease-c',story_lease_until=statement_timestamp()+interval '5 minutes',story_container_id='story-container-c',story_container_status='FINISHED'
    where id='00000000-0000-0000-0000-000000000303';
  update dmflow.scheduled_reels set status='processing',publish_state='processing',claim_token='lease-d',lease_until=statement_timestamp()+interval '5 minutes',container_id='container-d',container_status='FINISHED'
    where id='00000000-0000-0000-0000-000000000304';
  update dmflow.scheduled_reels set status='published',publish_state='published',post_id='published-d',published_at=statement_timestamp(),permalink=null
    where id='00000000-0000-0000-0000-000000000304';
  update dmflow.scheduled_reels set metadata_status='processing',metadata_claim_token='metadata-d',metadata_lease_until=statement_timestamp()+interval '5 minutes'
    where id='00000000-0000-0000-0000-000000000304';
$sql$, 'Reel and Story claim states can be staged for bounded recovery tests');

set local role service_role;
select ok(dmflow.begin_reel_graph_action('00000000-0000-0000-0000-000000000301','reel','lease-a','create',statement_timestamp()),
  'worker durably records the Reel create phase before a Graph call');
select ok(not dmflow.begin_reel_graph_action('00000000-0000-0000-0000-000000000301','reel','lease-a','publish',statement_timestamp()),
  'a claimed phase cannot be overwritten with a second Graph action');
select ok(dmflow.begin_reel_graph_action('00000000-0000-0000-0000-000000000302','reel','lease-b','poll',statement_timestamp()),
  'worker durably records the safe Reel status poll phase');
select ok(dmflow.begin_reel_graph_action('00000000-0000-0000-0000-000000000303','story','story-lease-c','publish',statement_timestamp()),
  'worker durably records associated Story publish phase');
select ok(dmflow.begin_reel_graph_action('00000000-0000-0000-0000-000000000304','metadata','metadata-d','lookup',statement_timestamp()),
  'worker durably records permalink GET phase after a Reel receipt exists');

update dmflow.scheduled_reels set lease_until=statement_timestamp()-interval '1 second', story_lease_until=statement_timestamp()-interval '1 second', metadata_lease_until=statement_timestamp()-interval '1 second'
 where id in ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000304');
select is((select count(*)::integer from dmflow.recover_expired_reel_claims(statement_timestamp()-interval '0.5 seconds')),4,
  'recovery processes all four expired Reel/Story/metadata leases exactly once');
select is((select publish_state from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000301'),
  'needs_reconciliation'::text,'expired Reel create request cannot be sent again');
select is((select status from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000301'),
  'error'::text,'uncertain Reel create is visibly stopped for manual reconciliation');
select is((select publish_state from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000302'),
  'pending'::text,'expired status GET safely returns to pending');
select is((select container_id from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000302'),
  'container-b'::text,'safe poll recovery preserves the created container id');
select is((select story_publish_state from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000303'),
  'needs_reconciliation'::text,'expired associated Story publish cannot be retried');
select is((select post_id from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000304'),
  'published-d'::text,'metadata recovery preserves the confirmed Reel post id');
select is((select metadata_status from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000304'),
  'pending'::text,'expired permalink GET can be safely retried independently');
select is((select permalink from dmflow.scheduled_reels where id='00000000-0000-0000-0000-000000000304'),
  null::text,'metadata lookup does not fabricate a permalink');
reset role;

select * from finish();
rollback;
