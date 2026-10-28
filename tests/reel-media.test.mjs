import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyReelAssets, verifyStoryAsset } from "../supabase/functions/publish-reel/media.ts";

const base = "https://zoknypleoribwomifzgi.supabase.co";
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const video = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, ...Array(12).fill(0)]);
const cover = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 8, 1, 2, 3, 4, 5, 6]);
const url = (name) => `${base}/storage/v1/object/public/dmflow-content/reels/${name}`;
const row = () => ({ video_url: url("video.mp4"), video_sha256: sha(video), cover_url: url("cover.jpg"),
  cover_sha256: sha(cover), story_url: url("story.mp4"), story_sha256: sha(video) });

test("stream verifies hash, MIME and MP4/JPEG signatures with no redirects", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    const bytes = String(input).endsWith("cover.jpg") ? cover : video;
    const mime = String(input).endsWith("cover.jpg") ? "image/jpeg" : "video/mp4";
    return new Response(bytes, { headers: { "content-type": mime, "content-length": String(bytes.length) } });
  };
  try {
    await verifyReelAssets(row(), base);
    await verifyStoryAsset(row(), base);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(({ init }) => init.redirect === "error"));
  } finally { globalThis.fetch = original; }
});

test("media fetch rejects foreign origins before sending a request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(video, { headers: { "content-type": "video/mp4" } }); };
  try {
    await assert.rejects(verifyStoryAsset({ ...row(), story_url: "https://example.com/story.mp4" }, base), /outside the approved Geek Academy bucket/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("media fetch rejects content whose bytes differ from the approved fingerprint", async () => {
  const original = globalThis.fetch;
  const changed = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, ...Array(12).fill(9)]);
  globalThis.fetch = async () => new Response(changed, { headers: { "content-type": "video/mp4" } });
  try {
    await assert.rejects(verifyStoryAsset(row(), base), /bytes differ from the owner-approved hash/);
  } finally { globalThis.fetch = original; }
});

