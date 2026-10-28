import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as metaGraph from "../supabase/functions/_shared/meta-graph.ts";

const { createMetaGraphClient, resolveInstagramIdentity } = metaGraph;
const assertAuthorizedInstagramAccount = (account) => {
  assert.equal(typeof metaGraph.assertAuthorizedInstagramAccount, "function",
    "meta-graph must export assertAuthorizedInstagramAccount");
  return metaGraph.assertAuthorizedInstagramAccount(account);
};

const accessToken = "test-secret-token-do-not-leak";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 401, async json() { return body; } };
}

test("Graph GET and POST send the secret only as a Bearer header", async () => {
  const requests = [];
  const graph = createMetaGraphClient({
    graphVersion: "v25.0",
    accessToken,
    instagramUserId: "ig-user-42",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return response({ id: "container-1", status_code: "FINISHED", permalink: "https://instagram.com/p/x/" });
    },
  });

  await graph.createChild({ imageUrl: "https://cdn.example/slide.png" });
  await graph.getContainerStatus("container-1");

  assert.equal(requests.length, 2);
  for (const { url, init } of requests) {
    assert.equal(url.includes(accessToken), false, "access token must not appear in the URL");
    assert.equal(init.headers.Authorization, `Bearer ${accessToken}`);
    assert.equal(init.body?.includes(accessToken) ?? false, false, "access token must not appear in the request body");
    assert.ok(init.signal instanceof AbortSignal, "GET and POST requests must have a timeout signal");
  }
});

test("Graph requests have a bounded timeout signal", async () => {
  const graph = createMetaGraphClient({
    graphVersion: "v25.0",
    accessToken,
    instagramUserId: "ig-user-42",
    requestTimeoutMs: 5,
    fetchImpl: async (_url, init = {}) => {
      assert.ok(init.signal instanceof AbortSignal, "Graph requests must have an abort deadline");
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });

  await Promise.all([
    assert.rejects(() => graph.getContainerStatus("container-1"), (error) => error?.name === "TimeoutError"),
    assert.rejects(() => graph.createChild({ imageUrl: "https://cdn.example/slide.png" }), (error) => error?.name === "TimeoutError"),
  ]);
});

test("resolves the Instagram user id from verified /me identity using the existing account schema", async () => {
  const requests = [];
  const instagramUserId = await resolveInstagramIdentity({
    graphVersion: "v25.0",
    now: Date.parse("2026-10-28T12:00:00.000Z"),
    account: {
      ig_business_id: "business-7",
      ig_username: "andreyogeek",
      ig_access_token: accessToken,
      ig_token_expires_at: "2026-11-15T00:00:00.000Z",
    },
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return response({ id: "verified-ig-id", username: "andreyogeek" });
    },
  });

  assert.equal(instagramUserId, "verified-ig-id");
  assert.match(requests[0].url, /\/me\?fields=id%2Cusername$/);
  assert.equal(requests[0].url.includes(accessToken), false);
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${accessToken}`);
});

test("publisher account lookup maps only columns that exist in dmflow.accounts", async () => {
  const publisher = await readFile(path.join(root, "supabase", "functions", "publish-carousel", "index.ts"), "utf8");
  assert.match(publisher, /select\(["']active,ig_username,ig_access_token,ig_token_expires_at["']\)/,
    "publisher must read active state and established identity/token fields");
  assert.match(publisher, /assertAuthorizedInstagramAccount\(data\)[\s\S]{0,120}resolveInstagramIdentity/,
    "publisher must authorize the stored account before making the /me identity request");
  assert.doesNotMatch(publisher, /ig_user_id/, "dmflow.accounts has no ig_user_id column");
});

test("rejects inactive and non-andreyogeek accounts before any Graph request", async () => {
  let graphRequests = 0;
  const fetchImpl = async () => { graphRequests += 1; return response({ id: "wrong", username: "other" }); };
  const cases = [
    { active: false, ig_username: "andreyogeek", ig_access_token: accessToken, ig_token_expires_at: "2026-11-15T00:00:00Z" },
    { active: true, ig_username: "different_account", ig_access_token: accessToken, ig_token_expires_at: "2026-11-15T00:00:00Z" },
  ];

  for (const account of cases) {
    await assert.rejects(async () => {
      assertAuthorizedInstagramAccount(account);
      await resolveInstagramIdentity({ graphVersion: "v25.0", now: Date.now(), account, fetchImpl });
    }, /active|allowed|andreyogeek/i);
    assert.equal(graphRequests, 0, "account authorization must happen before /me or publishing requests");
  }
  assert.doesNotThrow(() => assertAuthorizedInstagramAccount({ active: true, ig_username: "andreyogeek" }));
});

test("refuses an expired account token without making a Graph request", async () => {
  let calls = 0;
  await assert.rejects(() => resolveInstagramIdentity({
    graphVersion: "v25.0",
    now: Date.parse("2026-10-28T12:00:00.000Z"),
    account: {
      ig_business_id: "business-7",
      ig_username: "andreyogeek",
      ig_access_token: accessToken,
      ig_token_expires_at: "2026-10-01T00:00:00.000Z",
    },
    fetchImpl: async () => { calls += 1; return response({ id: "x", username: "andreyogeek" }); },
  }), /expired/i);
  assert.equal(calls, 0);
});

test("rejects an /me identity that does not match the stored Instagram username", async () => {
  await assert.rejects(() => resolveInstagramIdentity({
    graphVersion: "v25.0",
    now: Date.parse("2026-10-28T12:00:00.000Z"),
    account: {
      ig_business_id: "business-7",
      ig_username: "andreyogeek",
      ig_access_token: accessToken,
      ig_token_expires_at: "2026-11-15T00:00:00.000Z",
    },
    fetchImpl: async () => response({ id: "other-id", username: "someone_else" }),
  }), /identity|username/i);
});
