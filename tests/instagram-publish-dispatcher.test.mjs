import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createInstagramPublishDispatcher } from "../supabase/functions/instagram-publish-dispatcher/handler.ts";

const token = "dispatch-test-secret";
const serviceKey = "service-role-test-secret";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const config = {
  supabaseUrl: "https://zoknypleoribwomifzgi.supabase.co",
  serviceRoleKey: serviceKey,
  dispatcherTokenSha256: hash(token),
};
const makeRequest = (secret = token) => new Request(
  "https://zoknypleoribwomifzgi.supabase.co/functions/v1/instagram-publish-dispatcher",
  { method: "POST", headers: { "x-instagram-dispatcher-token": secret }, body: "{}" },
);

test("dispatcher fails closed before touching the DB when configuration or token is invalid", async () => {
  let claims = 0;
  const deps = {
    config: { ...config, dispatcherTokenSha256: "" },
    repository: { async claim() { claims++; return null; }, async release() { return true; } },
  };
  assert.equal((await createInstagramPublishDispatcher(deps)(makeRequest())).status, 503);
  deps.config = config;
  assert.equal((await createInstagramPublishDispatcher(deps)(makeRequest("wrong"))).status, 401);
  assert.equal(claims, 0);
});

test("idle dispatcher performs no function call", async () => {
  let calls = 0, releases = 0;
  const response = await createInstagramPublishDispatcher({ config,
    repository: { async claim() { return null; }, async release() { releases++; return true; } },
    fetchImpl: async () => { calls++; return new Response(); },
  })(makeRequest());
  assert.deepEqual(await response.json(), { ok: true, status: "idle" });
  assert.equal(calls, 0);
  assert.equal(releases, 0);
});

test("each lease invokes exactly one local publisher lane and releases its claim", async (t) => {
  const lanes = [
    ["carousel", "publish-carousel", {}],
    ["reel", "publish-reel", { mode: "reel" }],
    ["reel_story", "publish-reel", { mode: "story" }],
    ["metadata", "publish-reel", { mode: "metadata" }],
  ];
  for (const [lane, name, body] of lanes) {
    await t.test(lane, async () => {
      let calls = 0, released;
      const response = await createInstagramPublishDispatcher({ config,
        now: () => 1_800_000_000_000,
        repository: {
          async claim(now) { assert.equal(now, 1_800_000_000_000); return { claim_token: "lease-1", lane }; },
          async release(claimToken, now) { released = [claimToken, now]; return true; },
        },
        fetchImpl: async (input, init) => {
          calls++;
          assert.equal(String(input), `https://zoknypleoribwomifzgi.supabase.co/functions/v1/${name}`);
          assert.equal(init.method, "POST");
          assert.equal(init.headers.Authorization, `Bearer ${serviceKey}`);
          assert.equal(init.headers.apikey, serviceKey);
          assert.deepEqual(JSON.parse(init.body), body);
          assert.equal(String(input).includes(token), false);
          assert.equal(init.body.includes(token), false);
          return Response.json({ status: "pending", id: "must-not-be-forwarded" });
        },
      })(makeRequest());
      assert.equal(calls, 1);
      assert.deepEqual(released, ["lease-1", 1_800_000_000_000]);
      assert.deepEqual(await response.json(), { ok: true, lane, status: "pending", http_status: 200 });
    });
  }
});

test("worker errors are sanitized and the lease is still released", async () => {
  let released = false;
  const response = await createInstagramPublishDispatcher({ config,
    repository: { async claim() { return { claim_token: "lease", lane: "reel" }; }, async release() { released = true; return true; } },
    fetchImpl: async () => new Response("sensitive upstream detail", { status: 500 }),
  })(makeRequest());
  const body = await response.text();
  assert.equal(response.status, 502);
  assert.equal(released, true);
  assert.equal(body.includes("sensitive upstream detail"), false);
});

test("worker reconciliation requests are surfaced as failed dispatcher outcomes", async () => {
  const response = await createInstagramPublishDispatcher({ config,
    repository: { async claim() { return { claim_token: "lease", lane: "reel_story" }; }, async release() { return true; } },
    fetchImpl: async () => Response.json({ status: "needs_reconciliation" }),
  })(makeRequest());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    ok: false, lane: "reel_story", status: "needs_reconciliation", http_status: 200,
  });
});

test("dispatcher refuses a stale lease release", async () => {
  const response = await createInstagramPublishDispatcher({ config,
    repository: { async claim() { return { claim_token: "lease", lane: "carousel" }; }, async release() { return false; } },
    fetchImpl: async () => Response.json({ status: "pending" }),
  })(makeRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "lease_expired");
});
