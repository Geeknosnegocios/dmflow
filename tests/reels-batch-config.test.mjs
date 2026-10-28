import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Reelsflow batch controller disables gateway JWT only for its own-key-validated endpoint", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.reels-batch-control\]\s+verify_jwt\s*=\s*false/);
  assert.match(config, /\[functions\.instagram-publish-dispatcher\]\s+verify_jwt\s*=\s*false/);
  assert.match(config, /schemas\s*=\s*\["public",\s*"dmflow"\]/);
});
