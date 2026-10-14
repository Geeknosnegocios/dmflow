import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { graphGet, graphPost, verifiedInstagramId } from "./instagram-publishing-graph.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("uses the Instagram Login endpoint and Bearer header without exposing the token in the URL", async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init };
    return Response.json({ id: "1784", username: "andreyogeek" });
  };
  assert.equal(await verifiedInstagramId("IGA-secret-test", "andreyogeek"), "1784");
  assert.match(call.url, /^https:\/\/graph\.instagram\.com\/v22\.0\/me\?fields=id%2Cusername$/);
  assert.equal(call.init.headers.Authorization, "Bearer IGA-secret-test");
  assert.equal(call.url.includes("IGA-secret-test"), false);
});

test("refuses an unexpected Instagram identity", async () => {
  globalThis.fetch = async () => Response.json({ id: "other", username: "other" });
  await assert.rejects(verifiedInstagramId("IGA-secret-test", "andreyogeek"), /não corresponde/);
});

test("creates Reel and Story containers with JSON and the same verified account", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ id: String(calls.length) });
  };
  await graphPost("1784/media", "IGA-secret-test", { media_type: "REELS", cover_url: "https://example.com/cover.jpg" });
  await graphPost("1784/media", "IGA-secret-test", { media_type: "STORIES", video_url: "https://example.com/story.mp4" });
  assert.deepEqual(calls.map(call => JSON.parse(call.init.body).media_type), ["REELS", "STORIES"]);
  assert.equal(calls.every(call => call.init.headers.Authorization === "Bearer IGA-secret-test"), true);
  assert.equal(calls.every(call => call.init.headers["Content-Type"] === "application/json"), true);
  assert.equal(calls.every(call => !call.url.includes("IGA-secret-test")), true);
});

test("does not echo Graph error details or the token", async () => {
  globalThis.fetch = async () => Response.json({ error: { code: 190, message: "IGA-secret-test" } }, { status: 400 });
  await assert.rejects(graphGet("me", "IGA-secret-test"), error => {
    assert.equal(error.message, "Instagram API HTTP 400, code 190");
    return true;
  });
});
