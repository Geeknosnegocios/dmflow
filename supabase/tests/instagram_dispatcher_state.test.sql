-- Run only in the disposable PG17 schema contract job.
begin;
create extension if not exists pgtap;
select plan(17);

select ok((select relrowsecurity from pg_class where oid='dmflow.instagram_dispatcher_state'::regclass),
  'dispatcher lease state is protected by RLS');
select ok(not has_table_privilege('service_role','dmflow.instagram_dispatcher_state','SELECT')
  and not has_table_privilege('service_role','dmflow.instagram_dispatcher_state','UPDATE'),
  'dispatcher state is reachable only through guarded RPCs');
select ok(exists(select 1 from pg_index where indrelid='dmflow.scheduled_carousels'::regclass
    and indisunique and pg_get_indexdef(indexrelid) ilike '%(account_id, publish_at)%'),
  'each Instagram account has only one Carousel queue item per timestamp');
select is((select enabled from dmflow.instagram_dispatcher_state where id=1),false,
  'new dispatcher is disabled until explicit cutover');
select ok(to_regprocedure('dmflow.claim_instagram_dispatcher_tick(timestamptz)') is not null
  and to_regprocedure('dmflow.release_instagram_dispatcher_tick(text,timestamptz)') is not null
  and to_regprocedure('dmflow.set_instagram_dispatcher_enabled(boolean,timestamptz)') is not null,
  'claim, release, and enable controls exist');
select ok(has_function_privilege('service_role','dmflow.claim_instagram_dispatcher_tick(timestamptz)','EXECUTE')
  and has_function_privilege('service_role','dmflow.release_instagram_dispatcher_tick(text,timestamptz)','EXECUTE')
  and has_function_privilege('service_role','dmflow.set_instagram_dispatcher_enabled(boolean,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','dmflow.claim_instagram_dispatcher_tick(timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','dmflow.set_instagram_dispatcher_enabled(boolean,timestamptz)','EXECUTE'),
  'only service role can run or enable the dispatcher');

insert into auth.users (id,email) values
  ('00000000-0000-0000-0000-000000000402','dispatcher-owner@example.invalid');
insert into dmflow.accounts (id,owner_user_id,active,ig_username,ig_business_id) values
  ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000402',true,
   'andreyogeek','17890000000000003');
insert into dmflow.approved_content (id,content_type,content_id,account_id,fingerprint,approved_by) values
  ('00000000-0000-0000-0000-000000000404','carousel','DISPATCH-CARD-1',
   '00000000-0000-0000-0000-000000000401','sha256:'||repeat('a',64),
   '00000000-0000-0000-0000-000000000402');
insert into dmflow.scheduled_carousels (id,card_id,account_id,canal,caption,image_urls,approval_fingerprint,publish_at,status)
values ('00000000-0000-0000-0000-000000000403','DISPATCH-CARD-1','00000000-0000-0000-0000-000000000401','GI',
  'approved caption',array['https://storage.example/one.png','https://storage.example/two.png'],
  'sha256:'||repeat('a',64),statement_timestamp()-interval '1 minute','scheduled');
create temporary table dispatcher_claim_capture (claim_token text, lane text) on commit drop;
grant select, insert on dispatcher_claim_capture to service_role;

set local role service_role;
select is((select count(*)::integer from dmflow.claim_instagram_dispatcher_tick(statement_timestamp())),0,
  'dispatcher claims no work before enablement');
select ok(dmflow.set_instagram_dispatcher_enabled(true,statement_timestamp()),
  'service role can enable the dispatcher after staged cutover');
insert into dispatcher_claim_capture select * from dmflow.claim_instagram_dispatcher_tick(statement_timestamp());
select is((select lane from dispatcher_claim_capture),'carousel'::text,
  'dispatcher selects one due local carousel lane');
select ok((select claim_token is not null and lane='carousel' from dispatcher_claim_capture),
  'successful lane claim returns an unguessable exclusive lease token');
select is((select count(*)::integer from dmflow.claim_instagram_dispatcher_tick(statement_timestamp())),0,
  'a concurrent tick cannot claim work while the lease is held');
select ok(not dmflow.set_instagram_dispatcher_enabled(false,statement_timestamp()),
  'dispatcher cannot be switched off while a worker holds a live lease');
select ok(not dmflow.release_instagram_dispatcher_tick('wrong-token',statement_timestamp()),
  'only the current claim token may release the lease');
select ok(dmflow.release_instagram_dispatcher_tick(
  (select claim_token from dispatcher_claim_capture),statement_timestamp()),
  'current worker can release its lease');
select ok(dmflow.set_instagram_dispatcher_enabled(false,statement_timestamp()),
  'dispatcher can be disabled after its worker releases the lease');
select is((select count(*)::integer from dmflow.claim_instagram_dispatcher_tick(statement_timestamp())),0,
  'disabled dispatcher remains idle even when local work is due');
select ok(position('scheduled_carousels' in pg_get_functiondef(
    'dmflow.claim_instagram_dispatcher_tick(timestamptz)'::regprocedure))>0
  and position('scheduled_reels' in pg_get_functiondef(
    'dmflow.claim_instagram_dispatcher_tick(timestamptz)'::regprocedure))>0
  and position('reel_story' in pg_get_functiondef(
    'dmflow.claim_instagram_dispatcher_tick(timestamptz)'::regprocedure))>0,
  'one coordinator rotates across local Carousel, Reel, associated Story, and metadata queues');
reset role;

select * from finish();
rollback;
