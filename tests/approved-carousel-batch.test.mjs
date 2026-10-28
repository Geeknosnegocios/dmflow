import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalCarouselFingerprint } from "../supabase/functions/_shared/publishing-state.ts";
import {
  APPROVED_CARDS,
  buildOwnerApprovalSql,
  cleanupTempRoot,
  loadApprovedCarouselPackages,
  pngDimensions,
  packageFingerprint,
  verifyCutoverReady,
} from "../scripts/register-approved-carousel-batch.mjs";

function png(width = 1080, height = 1350) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes,0);
  bytes.write("IHDR",12,"ascii");
  bytes.writeUInt32BE(width,16);
  bytes.writeUInt32BE(height,20);
  return bytes;
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(),"approved-carousel-fixture-"));
  for (const card of APPROVED_CARDS) {
    const folder = path.join(root,card.folder);
    const slides = path.join(folder,"slides");
    await mkdir(slides,{recursive:true});
    await writeFile(path.join(folder,"caption.txt"),`Legenda ${card.cardId}\n`);
    for(let index=1;index<=8;index++) {
      await writeFile(path.join(slides,`slide-${String(index).padStart(2,"0")}.png`),png());
    }
  }
  return root;
}

test("only the four allowlisted carousel folders with eight 1080x1350 PNGs load", async () => {
  const root=await fixtureRoot();
  try {
    const packages=await loadApprovedCarouselPackages(root);
    assert.deepEqual(packages.map((pkg)=>pkg.cardId),APPROVED_CARDS.map((card)=>card.cardId));
    assert.equal(packages.reduce((sum,pkg)=>sum+pkg.slides.length,0),32);
    assert.ok(packages.every((pkg)=>pkg.slides.every((slide)=>slide.dimensions.width===1080&&slide.dimensions.height===1350)));
    assert.throws(()=>pngDimensions(png(100,100),"bad slide"),/1080x1350/);
    assert.throws(()=>pngDimensions(Buffer.alloc(24),"not png"),/not PNG|PNG/);
  } finally { await cleanupTempRoot(root,"approved-carousel-fixture-"); }
});

test("server registration fingerprint matches the carousel publisher's canonical format", async () => {
  const root=await fixtureRoot();
  try {
    const [pkg]=await loadApprovedCarouselPackages(root);
    const hashes=pkg.slides.map((slide)=>slide.sha256);
    const actual=await packageFingerprint("account-1",pkg);
    const expected=await canonicalCarouselFingerprint({account_id:"account-1",card_id:pkg.cardId,
      caption:pkg.caption,slide_hashes:hashes});
    assert.equal(actual,expected);
  } finally { await cleanupTempRoot(root,"approved-carousel-fixture-"); }
});

test("approval SQL derives approved_by from the live account row and limits writes to the allowlist", async () => {
  const packages=APPROVED_CARDS.map((card,index)=>({cardId:card.cardId,fingerprint:`sha256:${String(index+1).repeat(64)}`}));
  const sql=buildOwnerApprovalSql("account-1",packages);
  assert.match(sql,/select id,owner_user_id from dmflow\.accounts/);
  assert.match(sql,/owner_account\.owner_user_id/);
  assert.match(sql,/active is true and lower\(ig_username\)='andreyogeek'/);
  assert.match(sql,/select 'carousel',requested\.content_id/);
  assert.match(sql,/on conflict\(content_type,content_id,fingerprint\) do nothing/);
  assert.doesNotMatch(sql,/keyword|dm_message|scheduled_carousels/i);
  assert.throws(()=>buildOwnerApprovalSql("account-1",[{cardId:"OTHER-CARD",fingerprint:"sha256:"+"f".repeat(64)}]),/W44/);
  const duplicated = [...APPROVED_CARDS.slice(0,3), APPROVED_CARDS[0]]
    .map((card,index)=>({cardId:card.cardId,fingerprint:`sha256:${String(index+1).repeat(64)}`}));
  assert.throws(()=>buildOwnerApprovalSql("account-1", duplicated),/W44/);
});

test("cutover readiness is required for approval writes and can be tested without a remote call", async () => {
  let calls=0;
  const blocked=await verifyCutoverReady({reelsflowEnv:null,vercelCronConfirmed:false,
    runner(){calls++;throw new Error("must not execute");}});
  assert.equal(blocked.ready,false);
  assert.equal(calls,0);
});
