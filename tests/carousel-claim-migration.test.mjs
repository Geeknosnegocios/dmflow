import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("atomic carousel claim requires the matching live owner-approved registry record", async () => {
  const migration = await readFile(path.join(root, "supabase", "migrations", "20261028141950_carousel_parent_checkpoint.sql"), "utf8");
  const claimFunction = migration.match(/create\s+or\s+replace\s+function\s+dmflow\.claim_carousel_by_card[\s\S]*?\$\$;/i)?.[0] ?? "";

  assert.ok(claimFunction, "claim_carousel_by_card must be defined in the ordered migration");
  assert.match(claimFunction, /approved_content/i, "claim must validate the immutable approval registry atomically");
  assert.match(claimFunction, /content_type\s*=\s*'carousel'/i);
  assert.match(claimFunction, /content_id\s*=\s*q\.card_id/i);
  assert.match(claimFunction, /account_id\s*=\s*q\.account_id/i);
  assert.match(claimFunction, /fingerprint\s*=\s*p_fingerprint/i);
  assert.match(claimFunction, /revoked_at\s+is\s+null/i, "revoked approvals must never be claimed");
});

test("carousel migration persists ordered slide hashes and parent status checkpoints", async () => {
  const base = await readFile(path.join(root, "supabase", "migrations", "20261028131021_centralize_instagram_publishing_state.sql"), "utf8");
  const migration = await readFile(path.join(root, "supabase", "migrations", "20261028141950_carousel_parent_checkpoint.sql"), "utf8");
  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+slide_hashes\s+text\[\]/i);
  assert.match(migration, /add\s+column\s+if\s+not\s+exists\s+parent_status\s+text/i);
  assert.match(`${base}\n${migration}`, /slide_container_ids[\s\S]{0,100}array_fill\s*\(\s*null/i,
    "fresh carousel rows need eight empty child-container checkpoints by default");
  assert.match(`${base}\n${migration}`, /slide_statuses[\s\S]{0,100}array_fill\s*\(\s*'PENDING'/i,
    "fresh carousel rows need eight PENDING statuses by default");
  const orderedMigrations = `${base}\n${migration}`;
  assert.match(orderedMigrations, /check\s*\([\s\S]{0,100}cardinality\s*\(\s*image_urls\s*\)\s*=\s*8/i,
    "image_urls must contain exactly eight entries");
  assert.match(orderedMigrations, /check\s*\([\s\S]{0,500}cardinality\s*\(\s*slide_container_ids\s*\)\s*=\s*8/i,
    "child container checkpoints must contain exactly eight entries");
  assert.match(orderedMigrations, /check\s*\([\s\S]{0,500}cardinality\s*\(\s*slide_statuses\s*\)\s*=\s*8/i,
    "child statuses must contain exactly eight entries");
});
