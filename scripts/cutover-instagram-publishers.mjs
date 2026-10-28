import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_REF = "zoknypleoribwomifzgi";
const LEGACY_REF = "xhpkjurfnpjopariasxe";
const LEGACY_TARGET_JOB = "publish-scheduled-daily-1005-brt";
const STORY_JOBS = ["post-story-0900", "post-story-1200", "post-story-1500", "post-story-1800", "post-story-2100"];
const LEGACY_XHP_JOBS = ["publish-carousel-cron", "post-carrossel-11h", "post-carrossel-19h"];
const MIGRATIONS = [
  { version: "20260424", file: "supabase/migrations/20260424_add_platform_column.sql", baseline: true },
  { version: "20261014", file: "supabase/migrations/20261014_reel_cover_story.sql", baseline: true },
  { version: "20261028131021", file: "supabase/migrations/20261028131021_centralize_instagram_publishing_state.sql" },
  { version: "20261028141950", file: "supabase/migrations/20261028141950_carousel_parent_checkpoint.sql" },
  { version: "20261028160000", file: "supabase/migrations/20261028160000_reel_publishing_state.sql" },
  { version: "20261028193000", file: "supabase/migrations/20261028193000_reel_claim_recovery_and_metadata.sql" },
  { version: "20261028200000", file: "supabase/migrations/20261028200000_instagram_dispatcher_state.sql" },
];
const DISPATCHER_JOB = "instagram-publishing-dispatcher";
const LEGACY_PROCESSING = ["GI-019:true", "TIER-2026-09-18:false"];
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function run(command, args, options = {}) {
  try {
    const windowsSupabase = process.platform === "win32" && command === "supabase";
    const executable = windowsSupabase ? process.execPath : command;
    const executableArgs = windowsSupabase
      ? [path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "supabase", "dist", "supabase.js"), ...args]
      : args;
    return execFileSync(executable, executableArgs, {
      cwd: options.cwd ?? WORKSPACE_ROOT,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
  } catch (error) {
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") :
      (typeof error?.stderr === "string" ? error.stderr : "");
    const stdout = Buffer.isBuffer(error?.stdout) ? error.stdout.toString("utf8") :
      (typeof error?.stdout === "string" ? error.stdout : "");
    const safeDetails = `${stderr}\n${stdout}`.split(/\r?\n/)
      .filter((line) => line.trim() && !/(token|password|secret|api.?key|authorization|bearer)/i.test(line))
      .join(" ").slice(0, 240);
    const code = error?.status ?? error?.code ?? "unknown";
    throw new Error(`${command} ${args[0] ?? "operation"} failed (${code})${safeDetails ? `: ${safeDetails}` : "; details suppressed"}`);
  }
}

function parseJsonOutput(output, label) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`${label}: Supabase CLI did not return JSON`);
  try { return JSON.parse(output.slice(start, end + 1)); }
  catch { throw new Error(`${label}: Supabase CLI returned invalid JSON`); }
}

function runQuery(workdir, sql) {
  const output = run("supabase", ["db", "query", "--workdir", workdir, "--linked", "--output-format", "json", sql]);
  const result = parseJsonOutput(output, "database preflight");
  return result.rows ?? [];
}

function runSqlFile(workdir, sqlFile) {
  run("supabase", ["db", "query", "--workdir", workdir, "--linked", "--file", sqlFile]);
}

async function createLinkedWorkdir(root, projectRef) {
  const directory = path.join(root, projectRef);
  await mkdir(path.join(directory, "supabase"), { recursive: true });
  const config = `project_id = "${projectRef}"\n\n[api]\nenabled = true\nschemas = ["public", "dmflow"]\nextra_search_path = ["public", "dmflow", "extensions"]\nmax_rows = 1000\n\n[db]\nmajor_version = 17\n`;
  await writeFile(path.join(directory, "supabase", "config.toml"), config, "utf8");
  run("supabase", ["link", "--workdir", directory, "--project-ref", projectRef, "--yes"]);
  return directory;
}

function assertOwnedTempRoot(root) {
  const resolved = path.resolve(root);
  const parent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith("instagram-publisher-cutover-")) {
    throw new Error("Refusing to clean a temporary directory outside the exact cutover temp root");
  }
}

async function cleanupTempRoot(root) {
  assertOwnedTempRoot(root);
  await rm(root, { recursive: true, force: true });
}

function parseEnvFile(raw) {
  const values = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

async function requireBatchToken(envPath, workdir) {
  if (!envPath) throw new Error("Pass --reelsflow-env with the existing local Reelsflow .env file");
  const env = parseEnvFile(await readFile(envPath, "utf8"));
  const rawToken = env.get("DMFLOW_BATCH_CONTROL_TOKEN");
  if (!rawToken) throw new Error("The Reelsflow batch token is absent from the supplied env file");
  const localHash = createHash("sha256").update(rawToken).digest("hex");

  const configuredSecrets = parseJsonOutput(
    run("supabase", ["secrets", "list", "--project-ref", TARGET_REF, "--output-format", "json"]),
    "Edge secret preflight",
  ).secrets ?? [];
  const configuredHash = configuredSecrets.find((secret) => secret.name === "REELS_BATCH_TOKEN_SHA256")?.value;
  if (typeof configuredHash === "string" && configuredHash.toLowerCase() === localHash) return localHash;

  run("supabase", ["functions", "download", "reels-batch-control", "--project-ref", TARGET_REF,
    "--use-api", "--workdir", workdir]);
  const functionSource = await readFile(path.join(workdir, "supabase", "functions", "reels-batch-control", "index.ts"), "utf8");
  const oldHash = functionSource.match(/TOKEN_SHA256\s*=\s*["']([0-9a-f]{64})["']/i)?.[1]?.toLowerCase();
  if (!oldHash || oldHash !== localHash) {
    throw new Error("The local Reelsflow token does not match the currently deployed controller; no cutover was made");
  }
  return localHash;
}

async function readPreflight(targetWorkdir, xhpWorkdir, vercelConfirmed) {
  const targetRows = runQuery(targetWorkdir, `
    select
      (select count(*)::int from cron.job where active and jobname like 'post-story-%') as active_story_jobs,
      (select count(*)::int from cron.job where jobname='${LEGACY_TARGET_JOB}' and active) as active_legacy_target_jobs,
      (select count(*)::int from cron.job where jobname='${DISPATCHER_JOB}' and active) as active_dispatcher_jobs,
      (select to_regclass('dmflow.instagram_dispatcher_state') is not null) as has_dispatcher_state,
      (select exists(select 1 from cron.job where jobname='${DISPATCHER_JOB}')) as has_dispatcher_job,
      (select count(*)::int from information_schema.columns where table_schema='dmflow' and table_name='scheduled_reels' and column_name='metadata_status') as has_metadata_lane,
      (select count(*)::int from cron.job where active and jobname='${LEGACY_TARGET_JOB}' and substring(command from 'functions/v1/([A-Za-z0-9_-]+)')='publish-scheduled-cron') as active_cross_project_target_worker,
      (select count(*)::int from cron.job where active and substring(command from 'functions/v1/([A-Za-z0-9_-]+)') in ('publish-scheduled-cron','publish-carousel','publish-reel') and jobname <> '${LEGACY_TARGET_JOB}' and jobname <> '${DISPATCHER_JOB}' and jobname not like 'post-story-%') as active_other_target_instagram_workers,
      (select to_regclass('dmflow.scheduled_carousels') is not null) as has_carousel_queue,
      (select to_regclass('dmflow.scheduled_reels') is not null) as has_reel_queue
  `);
  const xhpRows = runQuery(xhpWorkdir, `
    select
      (select coalesce(string_agg(jobname, ',' order by jobname),'') from cron.job where active and jobname=any(array['${LEGACY_XHP_JOBS.join("','")}'])) as active_legacy_jobs,
      (select count(*)::int from cron.job where active and jobname in ('${LEGACY_XHP_JOBS.join("','")}')) as active_legacy_job_count,
      (select count(*)::int from public.scheduled_publications where status in ('scheduled','pending') and publish_at > statement_timestamp()) as future_publications,
      (select count(*)::int from public.carrossel_queue where status in ('scheduled','pending') and scheduled_at > statement_timestamp()) as future_carousels,
      (select count(*)::int from public.carrossel_queue where status='processing') as carousel_processing_count,
      (select coalesce(string_agg(card_id || ':' || (post_id is not null)::text, ',' order by card_id),'') from public.scheduled_publications where status='processing') as publication_processing_history,
      (select coalesce(string_agg(jobname, ',' order by jobname),'') from cron.job where active and
        (substring(command from 'functions/v1/([A-Za-z0-9_-]+)') in ('publish-carousel','post-instagram-carousel','publish-scheduled','publicar-instagram') or jobname like 'post-carrossel-%')
        and jobname <> all(array['${LEGACY_XHP_JOBS.join("','")}'])) as active_other_instagram_workers
  `);
  const target = targetRows[0] ?? {};
  const xhp = xhpRows[0] ?? {};
  let productionRouteStatus = 0;
  try {
    const response = await fetch("https://dmflow.geekacademy.site/api/cron/publish-reels", {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    productionRouteStatus = response.status;
    await response.body?.cancel();
  } catch { productionRouteStatus = 0; }
  if (target.has_dispatcher_state === true) {
    const state = runQuery(targetWorkdir, "select enabled from dmflow.instagram_dispatcher_state where id=1");
    target.dispatcher_enabled = state[0]?.enabled ?? null;
  } else {
    target.dispatcher_enabled = null;
  }
  const vercelConfig = JSON.parse(await readFile(path.join(WORKSPACE_ROOT, "vercel.json"), "utf8"));
  const sourceVercelCronCount = (vercelConfig.crons ?? []).filter((cron) => cron.path === "/api/cron/publish-reels").length;
  const activeXhpJobs = String(xhp.active_legacy_jobs ?? "").split(",").filter(Boolean);
  const checks = {
    vercelSourceCronCount: sourceVercelCronCount,
    vercelProductionRouteRetired: productionRouteStatus === 410,
    vercelProductionCronsConfirmedRemoved: vercelConfirmed,
    storyJobsRetained: Number(target.active_story_jobs) === 5,
    expectedLegacyTargetJob: Number(target.active_legacy_target_jobs) <= 1,
    legacyTargetJobContractMatches: Number(target.active_cross_project_target_worker) === Number(target.active_legacy_target_jobs),
    noOtherTargetInstagramWorkers: Number(target.active_other_target_instagram_workers) === 0,
    dispatcherNotAlreadyActive: Number(target.active_dispatcher_jobs) === 0,
    dispatcherSchemaReady: target.has_dispatcher_state === true,
    reelMetadataSchemaReady: Number(target.has_metadata_lane) === 1,
    dispatcherDisabled: target.dispatcher_enabled !== true,
    xhpOnlyExpectedLegacyJobs: activeXhpJobs.every((name) => LEGACY_XHP_JOBS.includes(name)) &&
      Number(xhp.active_legacy_job_count) <= LEGACY_XHP_JOBS.length,
    noOtherXhpInstagramWorkers: String(xhp.active_other_instagram_workers ?? "") === "",
    noFutureXhpPublications: Number(xhp.future_publications) === 0 && Number(xhp.future_carousels) === 0,
    noXhpProcessingCarouselRows: Number(xhp.carousel_processing_count) === 0,
    oldProcessingRowsPreserved: xhp.publication_processing_history === LEGACY_PROCESSING.join(","),
    noTargetDispatcherScheduleYet: target.has_dispatcher_job === false,
  };
  let queue = { runnable_carousels: 0, processing_reels: 0, runnable_reels: 0, runnable_stories: 0, runnable_metadata: 0 };
  if (target.has_carousel_queue === true && target.has_reel_queue === true && Number(target.has_metadata_lane) === 1) {
    const queueRows = runQuery(targetWorkdir, `
      select
        (select count(*)::int from dmflow.scheduled_carousels where status in ('scheduled','processing')) as runnable_carousels,
        (select count(*)::int from dmflow.scheduled_reels where status='processing' or publish_state='processing') as processing_reels,
        (select count(*)::int from dmflow.scheduled_reels where status='pending' and publish_state='pending') as runnable_reels,
        (select count(*)::int from dmflow.scheduled_reels where status='published' and publish_state='published' and story_status='pending' and story_publish_state='pending') as runnable_stories,
        (select count(*)::int from dmflow.scheduled_reels where status='published' and publish_state='published' and metadata_status in ('pending','processing') and post_id is not null and permalink is null) as runnable_metadata
    `);
    queue = queueRows[0] ?? queue;
  }
  return { checks, target: { active_story_jobs: Number(target.active_story_jobs), active_legacy_target_jobs: Number(target.active_legacy_target_jobs), active_cross_project_target_worker: Number(target.active_cross_project_target_worker), active_other_target_instagram_workers: Number(target.active_other_target_instagram_workers), active_dispatcher_jobs: Number(target.active_dispatcher_jobs), dispatcher_enabled: target.dispatcher_enabled, queue }, xhp: { active_legacy_jobs: xhp.active_legacy_jobs, active_other_instagram_workers: xhp.active_other_instagram_workers, future_publications: Number(xhp.future_publications), future_carousels: Number(xhp.future_carousels), carousel_processing_count: Number(xhp.carousel_processing_count), processing_history: xhp.publication_processing_history }, vercelProductionRouteStatus: productionRouteStatus };
}

function allReadinessChecksPassed(report, { requireVercelConfirmation, requireSchemaReady = true }) {
  const { checks } = report;
  return Object.entries(checks).every(([key, value]) => key === "vercelProductionCronsConfirmedRemoved" && !requireVercelConfirmation
    ? true
    : !requireSchemaReady && ["dispatcherSchemaReady", "reelMetadataSchemaReady"].includes(key)
      ? true
    : value === true || (key === "vercelSourceCronCount" && value === 0));
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function markMigrationApplied(targetWorkdir, version) {
  run("supabase", ["migration", "repair", "--workdir", targetWorkdir, "--linked", "--status", "applied", version]);
}

async function remoteMigrationVersions(targetWorkdir, versions) {
  const values = versions.map(sqlLiteral).join(",");
  const rows = runQuery(targetWorkdir, `select version from supabase_migrations.schema_migrations where version = any(array[${values}]::text[]) order by version`);
  return new Set(rows.map((row) => String(row.version)));
}

async function applyTrackedInstagramMigrations(targetWorkdir) {
  const migrationDirectory = path.join(targetWorkdir, "supabase", "migrations");
  await mkdir(migrationDirectory, { recursive: true });
  for (const migration of MIGRATIONS) {
    await copyFile(path.join(WORKSPACE_ROOT, migration.file), path.join(migrationDirectory, path.basename(migration.file)));
  }
  const history = await remoteMigrationVersions(targetWorkdir, MIGRATIONS.map((item) => item.version));
  const baseline = MIGRATIONS.filter((item) => item.baseline);
  const missingBaseline = baseline.filter((item) => !history.has(item.version));
  if (missingBaseline.length) {
    const rows = runQuery(targetWorkdir, `
      select
        (select count(*)::int from information_schema.columns where table_schema='dmflow' and table_name='rules' and column_name='platform') as rules_platform,
        (select count(*)::int from information_schema.columns where table_schema='dmflow' and table_name='events' and column_name='platform') as events_platform,
        (select count(*)::int from pg_indexes where schemaname='dmflow' and indexname in ('idx_rules_platform','idx_events_platform')) as platform_indexes,
        (select count(*)::int from information_schema.columns where table_schema='dmflow' and table_name='scheduled_reels' and column_name=any(array['cover_url','story_url','story_status','story_container_id','story_post_id','story_published_at','story_error'])) as reel_story_columns,
        (select exists(select 1 from pg_constraint where conrelid='dmflow.scheduled_reels'::regclass and conname='scheduled_reels_story_status_check')) as reel_story_constraint
    `);
    const row = rows[0] ?? {};
    for (const migration of missingBaseline) {
      const ready = migration.version === "20260424"
        ? Number(row.rules_platform) === 1 && Number(row.events_platform) === 1 && Number(row.platform_indexes) === 2
        : Number(row.reel_story_columns) === 7 && row.reel_story_constraint === true;
      if (!ready) throw new Error(`Baseline schema for ${migration.version} is incomplete; no migration history was rewritten`);
      await markMigrationApplied(targetWorkdir, migration.version);
    }
  }

  const applied = await remoteMigrationVersions(targetWorkdir, MIGRATIONS.map((item) => item.version));
  for (const migration of MIGRATIONS.filter((item) => !item.baseline && !applied.has(item.version))) {
    const source = await readFile(path.join(WORKSPACE_ROOT, migration.file), "utf8");
    const sql = `begin;\n${source}\ncommit;\n`;
    const migrationFile = path.join(targetWorkdir, "supabase", `.cutover-${migration.version}.sql`);
    await writeFile(migrationFile, sql, "utf8");
    try {
      run("supabase", ["db", "query", "--workdir", targetWorkdir, "--linked", "--file", migrationFile]);
      await markMigrationApplied(targetWorkdir, migration.version);
      applied.add(migration.version);
    } finally {
      const resolved = path.resolve(migrationFile);
      if (path.dirname(resolved) !== path.resolve(targetWorkdir, "supabase") || !path.basename(resolved).startsWith(".cutover-")) {
        throw new Error("Refusing to remove a migration SQL file outside the isolated Supabase workdir");
      }
      await rm(migrationFile, { force: true });
    }
  }
}

async function stageLegacyPublishersOff(xhpWorkdir, targetWorkdir) {
  const jobs = LEGACY_XHP_JOBS.map(sqlLiteral).join(",");
  runQuery(xhpWorkdir, `update cron.job set active=false where active and jobname=any(array[${jobs}]::text[]) returning jobname`);
  runQuery(targetWorkdir, `update cron.job set active=false where active and jobname=${sqlLiteral(LEGACY_TARGET_JOB)} returning jobname`);
  const report = await readPreflight(targetWorkdir, xhpWorkdir, true);
  if (Number(report.target.active_legacy_target_jobs) !== 0 || Number(report.target.active_other_target_instagram_workers) !== 0 ||
      Number(report.xhp.active_legacy_job_count) !== 0 || String(report.xhp.active_other_instagram_workers ?? "") !== "" ||
      Number(report.target.active_story_jobs) !== 5) {
    throw new Error("Legacy publisher shutdown verification failed; the new dispatcher was not enabled");
  }
}

async function assertTargetQueueIdle(targetWorkdir) {
  const rows = runQuery(targetWorkdir, `
    select
      (select count(*)::int from dmflow.scheduled_carousels where status in ('scheduled','processing')) as active_carousels,
      (select count(*)::int from dmflow.scheduled_reels where status='processing' or publish_state='processing' or story_publish_state='processing') as processing_reels,
      (select count(*)::int from dmflow.scheduled_reels where status='pending' and publish_state='pending') as pending_reels,
      (select count(*)::int from dmflow.scheduled_reels where status='published' and publish_state='published' and story_status='pending' and story_publish_state='pending') as pending_stories,
      (select count(*)::int from dmflow.scheduled_reels where status='published' and publish_state='published' and metadata_status in ('pending','processing') and post_id is not null and permalink is null) as pending_metadata
  `);
  const counts = rows[0] ?? {};
  if (Object.values(counts).some((value) => Number(value) !== 0)) {
    throw new Error("Target project has runnable Instagram rows; the staged dispatcher will remain disabled");
  }
}

async function setupDispatcherSecretAndCron(targetWorkdir, token) {
  const secretName = "instagram_dispatcher_token";
  const sqlFile = path.join(targetWorkdir, "supabase", ".cutover-dispatcher-secret.sql");
  const cronCommand = `select net.http_post(\n` +
    `  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/instagram-publish-dispatcher',\n` +
    `  headers := jsonb_build_object('Content-Type','application/json','x-instagram-dispatcher-token',\n` +
    `    (select decrypted_secret from vault.decrypted_secrets where name = '${secretName}')),\n` +
    `  body := '{}'::jsonb\n` +
    `);`;
  const sql = `begin;\n` +
    `do $cutover$ declare v_id uuid; begin\n` +
    `  select id into v_id from vault.secrets where name = '${secretName}' limit 1;\n` +
    `  if v_id is null then perform vault.create_secret('${token}', '${secretName}', 'Internal cron credential for the Instagram dispatcher');\n` +
    `  else perform vault.update_secret(v_id, '${token}', '${secretName}', 'Internal cron credential for the Instagram dispatcher'); end if;\n` +
    `end $cutover$;\n` +
    `select cron.schedule('${DISPATCHER_JOB}', '* * * * *', ${sqlLiteral(cronCommand)});\n` +
    `do $cutover$ begin if not dmflow.set_instagram_dispatcher_enabled(true, statement_timestamp()) then raise exception 'dispatcher enable rejected'; end if; end $cutover$;\n` +
    `commit;\n`;
  await writeFile(sqlFile, sql, "utf8");
  try {
    run("supabase", ["db", "query", "--workdir", targetWorkdir, "--linked", "--file", sqlFile]);
  } finally {
    const resolved = path.resolve(sqlFile);
    if (path.dirname(resolved) !== path.resolve(targetWorkdir, "supabase") || !path.basename(resolved).startsWith(".cutover-")) {
      throw new Error("Refusing to remove a dispatcher SQL file outside the isolated Supabase workdir");
    }
    await rm(sqlFile, { force: true });
  }
}

async function main() {
  const commit = process.argv.includes("--commit");
  const verifyOnly = process.argv.includes("--verify");
  const vercelConfirmed = process.argv.includes("--vercel-crons-removed");
  const envIndex = process.argv.indexOf("--reelsflow-env");
  const reelsflowEnv = envIndex >= 0 ? process.argv[envIndex + 1] : process.env.REELSFLOW_ENV_FILE;
  if (process.argv.some((arg) => arg.startsWith("--") && !["--commit", "--verify", "--vercel-crons-removed", "--reelsflow-env"].includes(arg)) ||
      (envIndex >= 0 && !process.argv[envIndex + 1])) {
    throw new Error("Usage: node scripts/cutover-instagram-publishers.mjs [--reelsflow-env path] [--vercel-crons-removed] [--commit|--verify]");
  }
  if (commit && verifyOnly) throw new Error("Choose either --commit or --verify");
  if (commit && !vercelConfirmed) {
    throw new Error("Before --commit, inspect Vercel Production → Settings → Cron Jobs and pass --vercel-crons-removed only after confirming zero /api/cron/publish-reels jobs");
  }
  const vercelConfig = JSON.parse(await readFile(path.join(WORKSPACE_ROOT, "vercel.json"), "utf8"));
  if ((vercelConfig.crons ?? []).some((cron) => cron.path === "/api/cron/publish-reels")) {
    throw new Error("The local vercel.json still schedules the legacy Reel publisher");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "instagram-publisher-cutover-"));
  assertOwnedTempRoot(tempRoot);
  let batchTokenHash = "";
  let dispatcherToken = "";
  let targetWorkdir;
  let xhpWorkdir;
  try {
    targetWorkdir = await createLinkedWorkdir(tempRoot, TARGET_REF);
    xhpWorkdir = await createLinkedWorkdir(tempRoot, LEGACY_REF);
    const report = await readPreflight(targetWorkdir, xhpWorkdir, vercelConfirmed);
    if (verifyOnly) {
      const verified = report.checks.storyJobsRetained &&
        Number(report.target.active_legacy_target_jobs) === 0 &&
        Number(report.target.active_dispatcher_jobs) === 1 &&
        report.target.dispatcher_enabled === true &&
        Number(report.xhp.active_legacy_job_count) === 0 &&
        String(report.xhp.active_other_instagram_workers ?? "") === "" &&
        report.checks.noOtherTargetInstagramWorkers &&
        report.checks.noFutureXhpPublications &&
        report.checks.oldProcessingRowsPreserved &&
        report.checks.vercelSourceCronCount === 0 && report.checks.vercelProductionRouteRetired && vercelConfirmed;
      console.log(JSON.stringify({ mode: "verify", ok: verified, report }));
      if (!verified) process.exitCode = 1;
      return;
    }
    const blockers = Object.entries(report.checks)
      .filter(([key, value]) => key !== "vercelProductionCronsConfirmedRemoved" &&
        !(key === "vercelSourceCronCount" && value === 0) && value !== true)
      .map(([key]) => key);
    if (report.checks.vercelSourceCronCount !== 0) blockers.push("vercelSourceCronCount");
    if (!allReadinessChecksPassed(report, { requireVercelConfirmation: false, requireSchemaReady: false })) {
      console.log(JSON.stringify({ mode: commit ? "commit" : "dry-run", ready: false, blockers, report }));
      if (commit) throw new Error("Cutover preflight failed; no publishers were changed");
      return;
    }

    if (!reelsflowEnv) throw new Error("Pass --reelsflow-env with the existing local Reelsflow .env.local file");
    const env = parseEnvFile(await readFile(reelsflowEnv, "utf8"));
    const rawBatchToken = env.get("DMFLOW_BATCH_CONTROL_TOKEN");
    if (!rawBatchToken) throw new Error("The supplied Reelsflow env file has no DMFLOW_BATCH_CONTROL_TOKEN");
    const batchTokenHashCandidate = createHash("sha256").update(rawBatchToken).digest("hex");

    const downloadDir = path.join(tempRoot, "legacy-function");
    await mkdir(path.join(downloadDir, "supabase"), { recursive: true });
    await writeFile(path.join(downloadDir, "supabase", "config.toml"), `project_id = "${TARGET_REF}"\n`, "utf8");
    run("supabase", ["link", "--workdir", downloadDir, "--project-ref", TARGET_REF, "--yes"]);
    run("supabase", ["functions", "download", "reels-batch-control", "--project-ref", TARGET_REF,
      "--use-api", "--workdir", downloadDir]);
    const oldFunctionSource = await readFile(path.join(downloadDir, "supabase", "functions", "reels-batch-control", "index.ts"), "utf8");
    const legacyHash = oldFunctionSource.match(/TOKEN_SHA256\s*=\s*["']([0-9a-f]{64})["']/i)?.[1]?.toLowerCase();
    if (!legacyHash || batchTokenHashCandidate !== legacyHash) {
      throw new Error("The Reelsflow local batch token does not match the deployed controller; no cutover was performed");
    }
    batchTokenHash = legacyHash;

    if (!commit) {
      console.log(JSON.stringify({ mode: "dry-run", preflightPassed: true, writes: 0,
        verifiedExistingBatchToken: true, vercelConfirmationRequiredForCommit: true,
        schemaAlreadyReady: report.checks.dispatcherSchemaReady && report.checks.reelMetadataSchemaReady, report }));
      return;
    }

    const secretNamesOutput = run("supabase", ["secrets", "list", "--project-ref", TARGET_REF, "--output-format", "json"]);
    const secretNames = parseJsonOutput(secretNamesOutput, "Edge secret preflight").secrets.map((secret) => secret.name);
    for (const required of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (!secretNames.includes(required)) throw new Error(`Missing required existing Edge secret: ${required}`);
    }
    if (!secretNames.includes("SUPABASE_PUBLISHABLE_KEY") && !secretNames.includes("SUPABASE_ANON_KEY")) {
      throw new Error("Missing the existing publishable/anon API key required by the batch controller");
    }

    await applyTrackedInstagramMigrations(targetWorkdir);
    await assertTargetQueueIdle(targetWorkdir);

    dispatcherToken = randomBytes(32).toString("base64url");
    const dispatcherHash = createHash("sha256").update(dispatcherToken).digest("hex");
    const edgeSecretFile = path.join(tempRoot, "edge-secrets.env");
    await writeFile(edgeSecretFile,
      `REELS_BATCH_TOKEN_SHA256=${batchTokenHash}\nINSTAGRAM_DISPATCHER_TOKEN_SHA256=${dispatcherHash}\n`, "utf8");
    run("supabase", ["secrets", "set", "--project-ref", TARGET_REF, "--env-file", edgeSecretFile]);
    await rm(edgeSecretFile, { force: true });

    for (const functionName of ["publish-carousel", "publish-reel", "reels-batch-control", "instagram-publish-dispatcher"]) {
      run("supabase", ["functions", "deploy", functionName, "--project-ref", TARGET_REF, "--workdir", WORKSPACE_ROOT, "--use-api"]);
    }

    await stageLegacyPublishersOff(xhpWorkdir, targetWorkdir);
    await setupDispatcherSecretAndCron(targetWorkdir, dispatcherToken);
    const finalReport = await readPreflight(targetWorkdir, xhpWorkdir, true);
    if (Number(finalReport.target.active_story_jobs) !== 5 || Number(finalReport.target.active_legacy_target_jobs) !== 0 ||
        Number(finalReport.target.active_dispatcher_jobs) !== 1 || finalReport.target.dispatcher_enabled !== true ||
        Number(finalReport.xhp.active_legacy_job_count) !== 0 || String(finalReport.xhp.active_other_instagram_workers ?? "") !== "" ||
        Number(finalReport.target.active_other_target_instagram_workers) !== 0) {
      throw new Error("Post-cutover schedule verification failed; dispatcher may be enabled but requires manual inspection");
    }
    console.log(JSON.stringify({ mode: "commit", ok: true, report: finalReport,
      storiesRetained: 5, oldGeekAcademyPublisherActive: false, oldXhpPublishersActive: 0,
      newDispatcher: "active every minute", legacyHistoryPreserved: true }));
  } finally {
    dispatcherToken = "";
    batchTokenHash = "";
    await cleanupTempRoot(tempRoot);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown cutover error";
  console.error(`Instagram publisher cutover stopped: ${message}`);
  process.exitCode = 1;
});
