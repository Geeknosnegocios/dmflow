import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { APPROVED_CARDS } from "../scripts/register-approved-carousel-batch.mjs";
import { carouselInsertSql, carouselSlidePath, chooseCarouselScheduleDates, existingCarouselBatchMatches, requestCarouselUploadSignature, uploadApprovedSlide, verifyRemoteSlide } from "../scripts/schedule-approved-carousels.mjs";

const hash = (char) => `sha256:${char.repeat(64)}`;
const fakePackage = (index) => ({
  cardId: APPROVED_CARDS[index].cardId,
  canal: APPROVED_CARDS[index].canal,
  caption: `approved caption ${index + 1}`,
  fingerprint: hash(String(index + 1)),
  slides: Array.from({ length: 8 }, (_, slide) => ({
    name: `slide-${String(slide + 1).padStart(2, "0")}.png`, sha256: hash("a"),
  })),
});

test("schedule planner skips weekends, occupied days, and near/past 10:06 BRT slots", () => {
  const plan = chooseCarouselScheduleDates({
    nowMs: Date.parse("2026-10-28T18:00:00Z"),
    occupiedDates: ["2026-10-29", "2026-11-02"],
  });
  assert.deepEqual(plan.map((item) => item.date), ["2026-10-30", "2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.ok(plan.every((item) => item.publishAt.endsWith("T10:06:00-03:00")));
  assert.throws(() => chooseCarouselScheduleDates({ nowMs: Date.now(), occupiedDates: [], count: 46 }), /45 dias/);
});

test("storage paths bind the exact allowlisted card, slide number, and approved hash prefix", () => {
  const path = carouselSlidePath(APPROVED_CARDS[0].cardId, {
    name: "slide-01.png", sha256: "sha256:0123456789abcdef" + "0".repeat(48),
  });
  assert.equal(path, `instagram/carousels/${APPROVED_CARDS[0].cardId}/slide-01-0123456789ab.png`);
  assert.throws(() => carouselSlidePath("UNAPPROVED-CARD", { name: "slide-01.png", sha256: hash("a") }), /lista W44/);
  assert.throws(() => carouselSlidePath(APPROVED_CARDS[0].cardId, { name: "slide-09.png", sha256: hash("a") }), /índice/i);
});

test("queue SQL inserts only four exact approved rows and never creates a DM keyword rule", () => {
  const publishDates = ["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"];
  const rows = APPROVED_CARDS.map((card, index) => ({ cardId: card.cardId, publishAt: `${publishDates[index]}T10:06:00-03:00`, pkg: fakePackage(index),
    slideUrls: Array.from({ length: 8 }, (_, slide) => `https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/${card.cardId}/${slide}.png`) }));
  const sql = carouselInsertSql("account-1", "owner-1", rows);
  assert.match(sql, /approved_content/);
  assert.match(sql, /approved_by/);
  assert.match(sql, /owner-1/);
  assert.match(sql, /publish_at/);
  assert.match(sql, /slide_hashes/);
  assert.match(sql, /on conflict\(card_id\) do nothing/);
  assert.doesNotMatch(sql, /keyword|dm_message|dmflow\.rules/i);
  assert.throws(() => carouselInsertSql("account-1", "owner-1", rows.slice(0, 3)), /quatro cards W44/);
  assert.throws(() => carouselInsertSql("account-1", "owner-1", [{ ...rows[0], cardId: "OTHER-CARD" }, ...rows.slice(1)]), /W44/);
});

test("stable Storage paths bind each approved slide hash to its queue URL", () => {
  const cardId = APPROVED_CARDS[0].cardId;
  const pkg = fakePackage(0);
  const urls = pkg.slides.map((slide) => `https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/${carouselSlidePath(cardId, slide)}`);
  const rows = [{ cardId, publishAt: "2026-10-29T10:06:00-03:00", pkg, slideUrls: urls },
    ...APPROVED_CARDS.slice(1).map((card,index)=>({cardId:card.cardId,publishAt:`2026-10-30T10:06:00-03:00`,pkg:fakePackage(index+1),slideUrls:Array(8).fill("https://example.invalid/slide.png")}))];
  const sql = carouselInsertSql("account-1", "owner-1", rows);
  assert.match(sql, /instagram\/carousels\/ANDREY-W44-2026-C01\/slide-01-/);
  assert.equal(urls.length, 8);
});

test("idempotent existing-batch check requires all four exact immutable rows and ordered asset URLs", () => {
  const accountId = "account-1";
  const packages = APPROVED_CARDS.map((card, index) => ({ ...fakePackage(index) }));
  const rows = packages.map((pkg) => ({
    card_id: pkg.cardId,
    account_id: accountId,
    canal: pkg.canal,
    caption: pkg.caption,
    approval_fingerprint: pkg.fingerprint,
    image_urls: pkg.slides.map((slide) => `https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/public/dmflow-content/${carouselSlidePath(pkg.cardId, slide)}`),
    slide_hashes: pkg.slides.map((slide) => slide.sha256),
    status: "scheduled",
    post_id: null,
    published_at: null,
  }));
  assert.equal(existingCarouselBatchMatches(packages, rows, accountId), true);
  assert.equal(existingCarouselBatchMatches(packages, rows.slice(0, 3), accountId), false);
  assert.equal(existingCarouselBatchMatches(packages, rows.map((row, i) => i ? row : ({ ...row, image_urls: [...row.image_urls].reverse() })), accountId), false);
  assert.equal(existingCarouselBatchMatches(packages, rows.map((row, i) => i ? row : ({ ...row, status: "published", post_id: "p1" })), accountId), false);
});

test("remote asset verification distinguishes missing objects from hash or MIME conflicts", async () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes, 0);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1080, 16);
  bytes.writeUInt32BE(1350, 20);
  const correct = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(await verifyRemoteSlide("https://example.invalid/slide.png", correct,
    async () => new Response(null, { status: 404 })), { exists: false });
  assert.deepEqual(await verifyRemoteSlide("https://example.invalid/slide.png", correct,
    async () => new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })), { exists: true });
  await assert.rejects(() => verifyRemoteSlide("https://example.invalid/slide.png", hash("f"),
    async () => new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })), /SHA-256/);
  await assert.rejects(() => verifyRemoteSlide("https://example.invalid/slide.png", correct,
    async () => new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } })), /PNG/);
});

test("approved slide upload uses only a matching signed URL and publishable headers", async () => {
  const bytes=Buffer.from("approved-slide-bytes");
  let captured;
  let signingRequest;
  const objectPath="instagram/carousels/ANDREY-W44-2026-C01/slide-01-0123456789ab.png";
  const signedUrl=`https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/upload/sign/dmflow-content/${objectPath}?token=single-use`;
  const result=await uploadApprovedSlide({
    supabaseUrl:"https://zoknypleoribwomifzgi.supabase.co",
    publishableKey:"publishable-key",
    objectPath,
    bytes,
    signUpload:async(path,contentType)=>{signingRequest={path,contentType};return {signedUrl,token:"single-use"};},
    fetchImpl:async(input,init)=>{captured={url:String(input),init};return new Response(null,{status:200});},
  });
  assert.equal(result.ok,true);
  assert.deepEqual(signingRequest,{path:objectPath,contentType:"image/png"});
  assert.equal(new URL(captured.url).origin,"https://zoknypleoribwomifzgi.supabase.co");
  assert.equal(captured.url,signedUrl);
  assert.equal(captured.init.headers.Authorization,"Bearer publishable-key");
  assert.equal(String(captured.init.body).includes("publishable-key"),false);
  assert.equal(captured.init.headers["x-upsert"],"false");
  await assert.rejects(()=>uploadApprovedSlide({supabaseUrl:"https://other.supabase.co",publishableKey:"k",
    objectPath,bytes,signUpload:async()=>{throw new Error("must not call");},
    fetchImpl:async()=>{throw new Error("must not call");}}),/only an approved W44 slide/);
  await assert.rejects(()=>uploadApprovedSlide({supabaseUrl:"https://zoknypleoribwomifzgi.supabase.co",publishableKey:"k",
    objectPath,bytes,signUpload:async()=>({signedUrl:"https://attacker.invalid/upload?token=single-use",token:"single-use"}),
    fetchImpl:async()=>{throw new Error("must not call");}}),/outside the approved object path/);
});

test("carousel upload signing authenticates to the target controller and rejects unsafe paths before network access", async () => {
  const objectPath="instagram/carousels/ANDREY-W44-2026-C04/slide-08-0123456789ab.png";
  let captured;
  const signature={signedUrl:`https://zoknypleoribwomifzgi.supabase.co/storage/v1/object/upload/sign/dmflow-content/${objectPath}?token=once`,token:"once"};
  const fetchImpl=async(input,init)=>{captured={url:String(input),init};return Response.json({ok:true,path:objectPath,contentType:"image/png",...signature});};
  const signed=await requestCarouselUploadSignature({controlUrl:"https://zoknypleoribwomifzgi.supabase.co/functions/v1/reels-batch-control",
    batchToken:"private-batch-token",publishableKey:"publishable-key",objectPath,fetchImpl});
  assert.deepEqual(signed,signature);
  assert.equal(captured.init.headers["x-reels-token"],"private-batch-token");
  assert.deepEqual(JSON.parse(captured.init.body),{action:"sign-carousel-upload",path:objectPath,contentType:"image/png"});
  await assert.rejects(()=>requestCarouselUploadSignature({controlUrl:"https://other.supabase.co/functions/v1/reels-batch-control",
    batchToken:"x",publishableKey:"k",objectPath,fetchImpl:async()=>{throw new Error("must not call");}}),/limited to approved W44/);
  await assert.rejects(()=>requestCarouselUploadSignature({controlUrl:"https://zoknypleoribwomifzgi.supabase.co/functions/v1/reels-batch-control",
    batchToken:"x",publishableKey:"k",objectPath:objectPath.replace("C04","C05"),fetchImpl:async()=>{throw new Error("must not call");}}),/limited to approved W44/);
});
