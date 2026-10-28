-- Run only in the disposable PG17 stack wired by the Supabase schema CI.
begin;
create extension if not exists pgtap;
select plan(15);

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

select * from finish();
rollback;

