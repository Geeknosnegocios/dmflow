import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readPublishingMigration() {
  const migrationDir = path.join(root, "supabase", "migrations");
  const files = await readdir(migrationDir);
  const file = files.find((name) => name.endsWith("_centralize_instagram_publishing_state.sql"));
  assert.ok(
    file,
    "missing Supabase migration *_centralize_instagram_publishing_state.sql; create it with `supabase migration new centralize_instagram_publishing_state`",
  );
  return readFile(path.join(migrationDir, file), "utf8");
}

test("publishing migration defines private queue, approval, idempotency, and no-retry contracts", async () => {
  const sql = (await readPublishingMigration()).toLowerCase();

  assert.match(sql, /create\s+schema\s+(if\s+not\s+exists\s+)?dmflow/);
  assert.doesNotMatch(sql, /revoke\s+all\s+on\s+schema\s+dmflow/i);
  assert.match(sql, /create\s+table\s+(if\s+not\s+exists\s+)?dmflow\.scheduled_carousels/);
  for (const field of [
    "card_id", "account_id", "canal", "caption", "image_urls", "approval_fingerprint",
    "publish_at", "slide_container_ids", "slide_statuses", "parent_container_id", "status",
    "post_id", "permalink", "error", "created_at", "updated_at",
  ]) assert.match(sql, new RegExp(`\\b${field}\\b`), `scheduled_carousels must define ${field}`);
  assert.match(sql, /(?:unique\s*\(\s*card_id\s*\)|card_id\s+\w+\s+not\s+null\s+unique)/);
  assert.match(sql, /references\s+dmflow\.accounts\s*\(\s*id\s*\)/);

  assert.match(sql, /create\s+table\s+(if\s+not\s+exists\s+)?dmflow\.approved_content/);
  for (const field of ["content_type", "content_id", "account_id", "fingerprint", "approved_by", "approved_at", "revoked_at"])
    assert.match(sql, new RegExp(`\\b${field}\\b`), `approved_content must define ${field}`);
  assert.match(sql, /unique\s*\([^;]*(content_type|content_id)[^;]*fingerprint/i);
  assert.match(sql, /approved_by[^;]*references\s+auth\.users\s*\(\s*id\s*\)/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+dmflow\.guard_approved_content_mutation/i);
  assert.match(sql, /a\.owner_user_id\s*=\s*new\.approved_by/i, "approval signer must own the referenced account");
  assert.match(sql, /before\s+insert\s+or\s+update\s+or\s+delete\s+on\s+dmflow\.approved_content/i);
  assert.match(sql, /approved content may only be revoked once/i);
  assert.match(sql, /approved content records cannot be deleted/i);
  assert.match(sql, /revoke\s+all\s+on\s+dmflow\.approved_content\s+from\s+public,\s*anon,\s*authenticated,\s*service_role/i);
  assert.match(sql, /grant\s+select,\s*insert\s+on\s+dmflow\.approved_content\s+to\s+service_role/i);
  assert.match(sql, /grant\s+update\s*\(\s*revoked_at\s*\)\s+on\s+dmflow\.approved_content\s+to\s+service_role/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*\bdelete\b[^;]*on\s+dmflow\.approved_content/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*\bupdate\b(?!\s*\(\s*revoked_at\s*\))[^;]*on\s+dmflow\.approved_content/i);

  assert.match(sql, /alter\s+table\s+dmflow\.scheduled_reels[\s\S]*?(approval|fingerprint|checkpoint)/i);
  assert.doesNotMatch(
    sql,
    /create\s+unique\s+index[\s\S]{0,180}on\s+dmflow\.scheduled_reels\s*\(\s*slug\s*\)/i,
    "a source video can have multiple Reel clips, so slug alone must not be unique",
  );
  assert.match(
    sql,
    /create\s+unique\s+index[\s\S]{0,180}on\s+dmflow\.scheduled_reels\s*\(\s*slug\s*,\s*idx\s*\)/i,
    "Reel source/clip identity must remain unique as the composite (slug, idx)",
  );
  assert.match(sql, /enable\s+row\s+level\s+security/);
  assert.match(sql, /revoke\s+all\s+on\s+(table\s+)?dmflow\./);
  assert.match(sql, /service_role/);
  assert.match(sql, /claim_due_carousels\s*\(\s*p_limit\s+integer\s*\)/);
  assert.match(sql, /skip\s+locked/);
  for (const state of ["draft", "scheduled", "processing", "needs_reconciliation", "published", "error", "paused"])
    assert.match(sql, new RegExp(`'${state}'`), `state machine must include ${state}`);
  assert.match(sql, /for\s+update[\s\S]{0,120}skip\s+locked/i, "claim RPC must atomically lock work rows");
  assert.doesNotMatch(sql, /xhp\.|dblink|postgres_fdw/i, "migration must not query legacy XHP data");
});

test("schema CI applies one migration and its database test to a disposable local project", async () => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "supabase-schema.yml"), "utf8");

  assert.match(workflow, /Prepare an empty temporary Supabase project[\s\S]*?mkdir -p [^\n]*supabase\/migrations/);
  assert.match(workflow, /Start disposable Supabase stack[\s\S]*?supabase --workdir "\$SUPABASE_TEST_PROJECT" start/);
  assert.match(workflow, /Create legacy schema fixture[\s\S]*?supabase --workdir "\$SUPABASE_TEST_PROJECT" db query --local --file "\$RUNNER_TEMP\/schema-fixture\.sql"/);
  assert.match(workflow, /Apply publishing migration to disposable database[\s\S]*?20261028131021_centralize_instagram_publishing_state\.sql/);
  assert.match(workflow, /Run database contract tests[\s\S]*?supabase\/tests\/instagram_publishing_state\.test\.sql/);
  assert.equal((workflow.match(/db query --local --file/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /--linked|db push/i, "schema CI must not target a linked or remote project");
});
