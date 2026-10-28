import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createReelBatchApprovalHandler } from "../app/api/v1/reels/approve-batch/handler.ts";
import { canonicalReelFingerprint, canonicalStoryFingerprint } from "../supabase/functions/_shared/reel-publishing.ts";
import { prepareReelBatch } from "../supabase/functions/reels-batch-control/handler.ts";

const base = "https://zoknypleoribwomifzgi.supabase.co";
const ownerId = "owner-from-verified-dmf-api-key";
const accountId = "active-instagram-account";
const now = Date.parse("2026-10-28T09:00:00-03:00");
const apiKey = "dmf_test-owner-api-key";
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function mp4(seed) { const b = Buffer.alloc(100_256, seed); b[4]=0x66;b[5]=0x74;b[6]=0x79;b[7]=0x70;return b; }
function jpg(seed) { const b=Buffer.alloc(2048,seed);b[0]=0xff;b[1]=0xd8;b[2]=0xff;return b; }
function item(idx) {
  const video=mp4(idx), cover=jpg(idx+10), story=mp4(idx+20);
  const stem=`reels/2026-10-29/B07no8JWSvo/reel-0${idx}-${sha(video).slice(7,19)}`;
  return { idx, caption:`Reviewed caption ${idx}`,
    video_url:`${base}/storage/v1/object/public/dmflow-content/${stem}.mp4`,
    cover_url:`${base}/storage/v1/object/public/dmflow-content/${stem}-cover.jpg`,
    story_url:`${base}/storage/v1/object/public/dmflow-content/${stem}-story.mp4`,
    caller_fingerprint:"forged", caller_approved_by:"forged-owner", __assets:{video,cover,story} };
}
function payload() { return { date:"2026-10-29", sourceVideoId:"B07no8JWSvo", channel:"GI", account:"andreyogeek", items:[1,2,3].map(item) }; }
function request(body) {
  const clean={...body,items:body.items.map(({__assets,...i})=>i)};
  return new Request("https://dmflow.geekacademy.site/api/v1/reels/approve-batch",{
    method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${apiKey}`},body:JSON.stringify(clean),
  });
}
function makeRepo(overrides={}) {
  const state={account:{id:accountId,owner_user_id:ownerId,active:true,ig_username:"andreyogeek"}, approvals:[], writes:0,...overrides};
  return {state,repository:{
    async getActiveAccount(){return state.account;},
    async listApprovals(type,id,account){return state.approvals.filter(a=>a.content_type===type&&a.content_id===id&&a.account_id===account);},
    async insertApprovals(rows){state.writes++;const inserted=rows.map((r,i)=>({id:`db-approval-${state.approvals.length+i}`,revoked_at:null,...r}));state.approvals.push(...inserted);return inserted;},
  }};
}
function fetchMedia(body) {
  const lookup=new Map();
  for(const i of body.items){lookup.set(i.video_url,i.__assets.video);lookup.set(i.cover_url,i.__assets.cover);lookup.set(i.story_url,i.__assets.story);}
  return async(url,init={})=>{
    assert.equal(init.redirect,"error");
    const bytes=lookup.get(String(url));
    if(!bytes)return new Response("missing",{status:404});
    const type=String(url).endsWith("-cover.jpg")?"image/jpeg":"video/mp4";
    return new Response(bytes,{headers:{"content-type":type,"content-length":String(bytes.length)}});
  };
}
function handler(repo, body, overrides={}) {
  return createReelBatchApprovalHandler({
    verifyApiKey:async raw=>raw===apiKey?{valid:true,user_id:ownerId}:{valid:false},
    repository:repo, supabaseUrl:base, fetchImpl:fetchMedia(body), now:()=>now, ...overrides,
  });
}

test("approval endpoint requires a valid dmf_ API key and does no lookup/write on invalid key", async()=>{
  const body=payload(),{repository,state}=makeRepo();let lookups=0;
  const controller=handler(repository,body,{verifyApiKey:async()=>{lookups++;return{valid:false};}});
  const res=await controller(request(body));
  assert.equal(res.status,401);assert.equal(lookups,1);assert.equal(state.writes,0);
});

test("approval endpoint fails closed outside the designated Geek Academy project", async()=>{
  const body=payload(),{repository,state}=makeRepo();let authCalls=0;
  const controller=handler(repository,body,{supabaseUrl:"https://example.supabase.co",verifyApiKey:async()=>{authCalls++;return{valid:true,user_id:ownerId};}});
  const res=await controller(request(body));
  assert.equal(res.status,503);assert.equal(authCalls,0);assert.equal(state.writes,0);
});

test("approval endpoint binds verified API key user to active account owner before media reads or writes", async()=>{
  const body=payload(),{repository,state}=makeRepo({account:{id:accountId,owner_user_id:"different-owner",active:true,ig_username:"andreyogeek"}});
  let fetches=0;
  const controller=handler(repository,body,{fetchImpl:async()=>{fetches++;return new Response();}});
  const res=await controller(request(body));
  assert.equal(res.status,403);assert.equal(fetches,0);assert.equal(state.writes,0);
});

test("explicit owner endpoint computes immutable Reel and Story fingerprints and ignores caller approver/fingerprint", async()=>{
  const body=payload();body.approved_by="forged";body.fingerprints=["forged"];
  const {repository,state}=makeRepo();
  await prepareReelBatch(body,state.account,{supabaseUrl:base},fetchMedia(body),now);
  const res=await handler(repository,body)(request(body));
  const result=await res.json();
  assert.equal(res.status,200,JSON.stringify(result));assert.equal(result.count,3);assert.equal(result.alreadyApproved,false);
  assert.equal(state.writes,1);assert.equal(state.approvals.length,6);
  assert.ok(state.approvals.every(a=>a.approved_by===ownerId));
  assert.ok(state.approvals.every(a=>/^sha256:[0-9a-f]{64}$/.test(a.fingerprint)));
  assert.deepEqual(state.approvals.map(a=>a.content_type).sort(),["reel","reel","reel","reel_story","reel_story","reel_story"]);
  for(const cut of body.items){
    const at=Date.parse(`2026-10-29T${["08:00","12:00","20:00"][cut.idx-1]}:00-03:00`)/1000;
    const record={account_id:accountId,slug:body.sourceVideoId,idx:cut.idx,canal:body.channel,
      video_url:cut.video_url,video_sha256:sha(cut.__assets.video),cover_url:cut.cover_url,
      cover_sha256:sha(cut.__assets.cover),story_url:cut.story_url,story_sha256:sha(cut.__assets.story),
      caption:cut.caption,scheduled_unix:at};
    const reelFingerprint=await canonicalReelFingerprint(record);
    assert.equal(state.approvals.find(a=>a.content_type==="reel"&&a.content_id===`${body.sourceVideoId}:${cut.idx}`).fingerprint,reelFingerprint);
    assert.equal(state.approvals.find(a=>a.content_type==="reel_story"&&a.content_id===`${body.sourceVideoId}:${cut.idx}`).fingerprint,
      await canonicalStoryFingerprint({...record,approval_fingerprint:reelFingerprint}));
  }
});

test("invalid media cannot create approvals; repeated identical approval is idempotent", async()=>{
  const body=payload(),{repository,state}=makeRepo();
  const altered=structuredClone(body);altered.items[0].video_url=altered.items[0].video_url.replace(/reel-01-[0-9a-f]{12}/,"reel-01-000000000000");
  const bad=await handler(repository,altered)(request(altered));
  assert.equal(bad.status,400);assert.equal(state.writes,0);assert.equal(state.approvals.length,0);

  const good=await handler(repository,body)(request(body));assert.equal(good.status,200);
  const again=await handler(repository,body)(request(body));
  assert.equal(again.status,200);assert.equal((await again.json()).alreadyApproved,true);
  assert.equal(state.writes,1);assert.equal(state.approvals.length,6);
});

test("revoked approval blocks a batch reapproval until the content receives a new revision", async()=>{
  const body=payload(),{repository,state}=makeRepo();
  const first=await handler(repository,body)(request(body));assert.equal(first.status,200);
  state.approvals[0].revoked_at="2026-10-28T10:00:00Z";
  const second=await handler(repository,body)(request(body));
  assert.equal(second.status,409);assert.equal(state.writes,1);
});

