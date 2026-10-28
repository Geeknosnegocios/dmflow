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

test("checked-in Supabase API config exposes the dmflow schema", async () => {
  const apiConfig = await readFile(path.join(root, "supabase", "config.toml"), "utf8");
  assert.match(apiConfig, /\[api\][\s\S]*?schemas\s*=\s*\[\s*"public"\s*,\s*"dmflow"\s*\]/i,
    "the checked-in Supabase API must expose dmflow for local client requests");
});

test("schema CI mirrors the API config and applies ordered migrations and pgTAP locally", async () => {
  const apiConfig = await readFile(path.join(root, "supabase", "config.toml"), "utf8");
  const workflow = await readFile(path.join(root, ".github", "workflows", "supabase-schema.yml"), "utf8");

  const disposableConfig = workflow.match(/cat > "\$project_dir\/supabase\/config\.toml" <<'TOML'([\s\S]*?)TOML/)?.[1] ?? "";
  assert.match(disposableConfig, /project_id\s*=\s*"zoknypleoribwomifzgi"[\s\S]*?\[api\][\s\S]*?schemas\s*=\s*\[\s*"public"\s*,\s*"dmflow"\s*\][\s\S]*?\[db\][\s\S]*?major_version\s*=\s*17/i,
    "the disposable CI config must match the checked-in API schemas and PostgreSQL major");
  assert.match(disposableConfig, /schemas\s*=\s*\[\s*"public"\s*,\s*"dmflow"\s*\]/i,
    "the disposable CI API config must match the checked-in config");
  assert.match(apiConfig, /schemas\s*=\s*\[\s*"public"\s*,\s*"dmflow"\s*\]/i);
  assert.match(workflow, /Prepare an empty temporary Supabase project[\s\S]*?mkdir -p [^\n]*supabase\/migrations/);
  const startCommand = workflow.match(/supabase --workdir "\$SUPABASE_TEST_PROJECT" start -x ([a-z,-]+)/i);
  assert.ok(startCommand, "the disposable stack must start without optional non-database services");
  assert.deepEqual(
    startCommand[1].split(",").sort(),
    ["edge-runtime", "gotrue", "imgproxy", "kong", "logflare", "mailpit", "postgres-meta", "postgrest", "realtime", "storage-api", "studio", "supavisor", "vector"].sort(),
    "exclude PostgREST and optional services so startup does not require dmflow before fixture migrations",
  );
  assert.match(workflow, /mkdir -p "?\$project_dir\/supabase\/migrations"?/);
  assert.match(workflow, /(?:find\s+"?\$project_dir\/supabase\/migrations"?[^\n]*-type\s+f\s+-delete|rm\s+-f\s+"\$project_dir"\/supabase\/migrations\/\*\.sql)/i,
    "the disposable migrations directory must be empty before ordered fixtures are added");
  assert.match(workflow, /Add ordered disposable migrations[\s\S]*?20261027000000_legacy_schema_fixture\.sql[\s\S]*?20261028131021_centralize_instagram_publishing_state\.sql/,
    "the empty temporary migration directory must receive the legacy fixture before the target migration");
  assert.match(workflow, /Apply ordered migrations to disposable database[\s\S]*?supabase --workdir "\$SUPABASE_TEST_PROJECT" migration up --local/);
  assert.match(workflow, /Run database contract tests[\s\S]*?supabase --workdir "\$SUPABASE_TEST_PROJECT" test db --local/);
  assert.doesNotMatch(workflow, /db\s+query[^\n]*--file/i, "CI must not feed multi-statement migration SQL through db query --file");
  assert.doesNotMatch(workflow, /--linked|db push/i, "schema CI must not target a linked or remote project");
});
