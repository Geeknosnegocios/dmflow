import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("legacy Reel scheduler fails closed with a migration response", async () => {
  const source = await readFile(new URL("../app/api/v1/schedule-reel/route.ts", import.meta.url), "utf8");
  assert.match(source, /export async function POST\(\)/);
  assert.match(source, /status:\s*410/);
  assert.match(source, /Reels.*centralizado/i);
  assert.doesNotMatch(source, /supabaseAdmin|\.insert\(/);
});
