import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel no longer schedules the legacy Instagram Reel publisher", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.crons.some((cron) => cron.path === "/api/cron/publish-reels"), false);
});

test("legacy Vercel Reel route is closed without Meta or queue access", async () => {
  const route = await readFile(new URL("../app/api/cron/publish-reels/route.ts", import.meta.url), "utf8");
  assert.match(route, /status:\s*410/);
  assert.doesNotMatch(route, /graphPost|graphGet|supabaseAdmin|scheduled_reels/);
});
