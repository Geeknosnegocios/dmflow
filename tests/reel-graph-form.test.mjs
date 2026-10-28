import assert from "node:assert/strict";
import { test } from "node:test";
import { createReelGraphClient } from "../supabase/functions/publish-reel/graph.ts";

const token = "test-bearer-secret-never-in-url-or-body";

test("Meta create and publish POSTs use form bodies and Bearer-only token transport", async () => {
  const calls = [];
  const graph = createReelGraphClient({ graphVersion: "v22.0", accessToken: token, instagramUserId: "ig-user-7",
    fetchImpl: async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: "container-123" }), { status: 200, headers: { "content-type": "application/json" } });
    } });

  await graph.createReel({ video_url: "https://storage.example/video.mp4", cover_url: "https://storage.example/cover.jpg",
    caption: "approved copy", story_url: "https://storage.example/story.mp4" });
  await graph.publishReel("container-123");

  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(new URL(url).search, "");
    assert.equal(url.includes(token), false);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.ok(init.body instanceof URLSearchParams);
    assert.equal(String(init.body).includes(token), false);
  }
  assert.equal(new URLSearchParams(calls[0].init.body).get("media_type"), "REELS");
  assert.equal(new URLSearchParams(calls[0].init.body).get("video_url"), "https://storage.example/video.mp4");
  assert.equal(new URLSearchParams(calls[0].init.body).get("cover_url"), "https://storage.example/cover.jpg");
  assert.equal(new URLSearchParams(calls[0].init.body).get("caption"), "approved copy");
  assert.equal(new URLSearchParams(calls[1].init.body).get("creation_id"), "container-123");
});

