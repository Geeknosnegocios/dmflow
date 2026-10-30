import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('repair migration supplies updated_at required by both existing claim functions',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/20261030172546_ensure_reel_claim_updated_at.sql',import.meta.url),'utf8');
 assert.match(sql,/alter table dmflow\.scheduled_reels\s+add column if not exists updated_at timestamptz/i);
 assert.doesNotMatch(sql,/update\s+dmflow\.scheduled_reels\s+set\s+(?:status|publish_state)/i);
});
