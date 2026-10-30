import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolveInstagramIdentity} from '../supabase/functions/_shared/meta-graph.ts';

const account={ig_username:'andreyogeek',ig_access_token:'test-secret',ig_token_expires_at:'2099-01-01T00:00:00Z',ig_business_id:'17841400000000001'};
function response(identity){return async url=>{
 assert.equal(new URL(url).searchParams.get('fields'),'id,user_id,username');
 return new Response(JSON.stringify(identity),{status:200});
};}
test('same Instagram account can return a scoped id and its stored user_id',async()=>{
 const actual=await resolveInstagramIdentity({graphVersion:'v22.0',now:0,account,
  fetchImpl:response({id:'27959000000000001',user_id:account.ig_business_id,username:'andreyogeek'})});
 assert.equal(actual,'27959000000000001');
});
test('a mismatched stored account id is still rejected before publishing',async()=>{
 await assert.rejects(()=>resolveInstagramIdentity({graphVersion:'v22.0',now:0,account,
  fetchImpl:response({id:'different-scoped-id',user_id:'different-user-id',username:'andreyogeek'})}),/identity.*stored account/i);
});
test('legacy stored scoped id remains accepted',async()=>{
 assert.equal(await resolveInstagramIdentity({graphVersion:'v22.0',now:0,account,
  fetchImpl:response({id:account.ig_business_id,username:'andreyogeek'})}),account.ig_business_id);
});
test('a different username is rejected even with matching user_id',async()=>{
 await assert.rejects(()=>resolveInstagramIdentity({graphVersion:'v22.0',now:0,account,
  fetchImpl:response({id:'scoped',user_id:account.ig_business_id,username:'another-account'})}),/username/i);
});
test('Reel worker delegates the id match instead of comparing unlike id namespaces',async()=>{
 const code=await readFile(new URL('../supabase/functions/publish-reel/index.ts',import.meta.url),'utf8');
 assert.doesNotMatch(code,/identity\s*!==\s*account\.ig_business_id/);
});
