import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalCarouselFingerprint } from "../supabase/functions/_shared/publishing-state.ts";

export const TARGET_REF = "zoknypleoribwomifzgi";
export const APPROVED_CARDS = [
  { cardId: "ANDREY-W44-2026-C01", folder: "carrossel-01", canal: "GI" },
  { cardId: "ANDREY-W44-2026-C02", folder: "carrossel-02", canal: "GN" },
  { cardId: "ANDREY-W44-2026-C03", folder: "carrossel-03", canal: "GN" },
  { cardId: "ANDREY-W44-2026-C04", folder: "carrossel-04", canal: "GN" },
];
export const MAX_SLIDE_BYTES = 10 * 1024 * 1024;
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = WORKSPACE_ROOT;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

export function runSupabase(args, cwd = WORKSPACE_ROOT) {
  const windows = process.platform === "win32";
  const executable = windows ? process.execPath : "supabase";
  const actualArgs = windows
    ? [path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "supabase", "dist", "supabase.js"), ...args]
    : args;
  try {
    return execFileSync(executable, actualArgs, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], shell: false });
  } catch {
    throw new Error("Supabase CLI operation failed; no publication is claimed");
  }
}

export function parseCliJson(output, label) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`${label}: resposta JSON indisponível`);
  try { return JSON.parse(output.slice(start, end + 1)); }
  catch { throw new Error(`${label}: resposta JSON inválida`); }
}

export function querySupabase(workdir, sql) {
  return parseCliJson(runSupabase(["db", "query", "--workdir", workdir, "--linked", "--output-format", "json", sql]),
    "Supabase query").rows ?? [];
}

export async function createLinkedWorkdir(tempRoot, projectRef = TARGET_REF) {
  const workdir = path.join(tempRoot, projectRef);
  await mkdir(path.join(workdir, "supabase"), { recursive: true });
  const config = `project_id = "${projectRef}"\n\n[api]\nenabled = true\nschemas = ["public", "dmflow"]\nextra_search_path = ["public", "dmflow", "extensions"]\nmax_rows = 1000\n\n[db]\nmajor_version = 17\n`;
  await writeFile(path.join(workdir, "supabase", "config.toml"), config, "utf8");
  runSupabase(["link", "--workdir", workdir, "--project-ref", projectRef, "--yes"]);
  return workdir;
}

export async function cleanupTempRoot(tempRoot, prefix) {
  const resolved = path.resolve(tempRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error("Refusing to remove a temporary folder outside its exact temp root");
  }
  await rm(resolved, { recursive: true, force: true });
}

export function pngDimensions(bytes, label = "PNG") {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${label}: arquivo não é PNG válido`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1080 || height !== 1350) throw new Error(`${label}: dimensão obrigatória 1080x1350`);
  if (bytes.length === 0 || bytes.length > MAX_SLIDE_BYTES) throw new Error(`${label}: tamanho fora do limite de 10 MiB`);
  return { width, height };
}

export async function loadApprovedCarouselPackages(assetsRoot) {
  const packages = [];
  for (const card of APPROVED_CARDS) {
    const cardRoot = path.resolve(assetsRoot, card.folder);
    const caption = (await readFile(path.join(cardRoot, "caption.txt"), "utf8")).trim();
    if (!caption || caption.length > 2200) throw new Error(`${card.cardId}: legenda vazia ou maior que o limite`);
    const slideRoot = path.join(cardRoot, "slides");
    const slideNames = (await readdir(slideRoot)).sort();
    const expectedNames = Array.from({ length: 8 }, (_, index) => `slide-${String(index + 1).padStart(2, "0")}.png`);
    if (JSON.stringify(slideNames) !== JSON.stringify(expectedNames)) throw new Error(`${card.cardId}: esperado exatamente oito slides PNG numerados`);
    const slides = [];
    for (const name of expectedNames) {
      const filePath = path.join(slideRoot, name);
      const bytes = await readFile(filePath);
      const dimensions = pngDimensions(bytes, `${card.cardId}/${name}`);
      const slideHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      slides.push({ filePath, name, bytes, dimensions, sha256: slideHash });
    }
    packages.push({ ...card, caption, slides });
  }
  return packages;
}

export async function packageFingerprint(accountId, pkg) {
  return canonicalCarouselFingerprint({
    account_id: accountId,
    card_id: pkg.cardId,
    caption: pkg.caption,
    slide_hashes: pkg.slides.map((slide) => slide.sha256),
  });
}

export function sqlQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export async function verifyCutoverReady({ reelsflowEnv, vercelCronConfirmed, runner = execFileSync } = {}) {
  if (!reelsflowEnv || vercelCronConfirmed !== true) return { ready: false, reason: "Cutover verification flags are missing" };
  const script = path.join(REPO_ROOT, "scripts", "cutover-instagram-publishers.mjs");
  const result = runner(process.execPath, [script, "--verify", "--vercel-crons-removed", "--reelsflow-env", reelsflowEnv], {
    cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], shell: false,
  });
  const output = typeof result === "string" ? result : result.toString();
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return { ready: false, reason: "Cutover verifier did not return a report" };
  try {
    const report = JSON.parse(output.slice(start, end + 1));
    return { ready: report.mode === "verify" && report.ok === true, reason: report.mode === "verify" && report.ok === true ? null : "Legacy cutover preflight is not clear" };
  } catch {
    return { ready: false, reason: "Cutover verifier report could not be parsed" };
  }
}

export function buildOwnerApprovalSql(accountId, packages) {
  const expectedIds = APPROVED_CARDS.map((card) => card.cardId).sort();
  const actualIds = packages.map((pkg) => pkg.cardId).sort();
  if (!accountId || packages.length !== 4 || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error("Aprovação limitada ao lote ANDREY W44 de quatro cards");
  }
  const values = packages.map((pkg) => `(${sqlQuote(pkg.cardId)},${sqlQuote(pkg.fingerprint)})`).join(",\n");
  return `begin;
with requested(content_id,fingerprint) as (values
${values}
), owner_account as (
  select id,owner_user_id from dmflow.accounts
   where id=${sqlQuote(accountId)} and active is true and lower(ig_username)='andreyogeek'
)
insert into dmflow.approved_content(content_type,content_id,account_id,fingerprint,approved_by)
select 'carousel',requested.content_id,owner_account.id,requested.fingerprint,owner_account.owner_user_id
  from requested cross join owner_account
on conflict(content_type,content_id,fingerprint) do nothing;
commit;
`;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const assetsRoot = argument("--assets-dir") ?? process.env.INSTAGRAM_CAROUSEL_ASSETS ??
    "C:\\Users\\freit\\Documents\\ChatGPT\\Instagram\\carrosseis-semana-26out";
  const packages = await loadApprovedCarouselPackages(assetsRoot);
  const reelsflowEnv = argument("--reelsflow-env") ?? process.env.REELSFLOW_ENV_FILE;
  const vercelCronConfirmed = process.argv.includes("--vercel-crons-removed");
  const cutover = await verifyCutoverReady({ reelsflowEnv, vercelCronConfirmed });
  if (!cutover.ready) {
    if (commit) throw new Error(`Owner approval registration requires completed publisher cutover: ${cutover.reason}`);
    console.log(JSON.stringify({ mode: "dry-run", ready: false, writes: 0, cards: 4, slides: 32,
      dimensions: "1080x1350", dmKeywordWrites: 0, reason: cutover.reason }));
    return;
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "instagram-carousel-approval-"));
  if (path.dirname(path.resolve(tempRoot)) !== path.resolve(os.tmpdir())) throw new Error("Invalid temp root");
  try {
  const workdir = await createLinkedWorkdir(tempRoot);
  const query = (sql) => querySupabase(workdir, sql);
  const accounts = query("select id,owner_user_id from dmflow.accounts where active is true and lower(ig_username)='andreyogeek' limit 2");
  if (accounts.length !== 1 || !accounts[0].id || !accounts[0].owner_user_id) {
    throw new Error("É necessário exatamente uma conta ativa @andreyogeek com proprietário definido");
  }
  const account = accounts[0];
  for (const pkg of packages) pkg.fingerprint = await packageFingerprint(account.id, pkg);

  const cardIds = packages.map((pkg) => sqlQuote(pkg.cardId)).join(",");
  const existing = query(`select content_id,fingerprint,account_id,approved_by,revoked_at from dmflow.approved_content where content_type='carousel' and account_id=${sqlQuote(account.id)} and content_id=any(array[${cardIds}]::text[]) order by content_id`);
  const missing = [];
  for (const pkg of packages) {
    const rows = existing.filter((row) => row.content_id === pkg.cardId);
    if (rows.some((row) => row.revoked_at !== null)) throw new Error(`${pkg.cardId}: há aprovação revogada; solicite nova revisão editorial`);
    const active = rows.filter((row) => row.revoked_at === null);
    if (active.some((row) => row.fingerprint !== pkg.fingerprint || row.approved_by !== account.owner_user_id)) {
      throw new Error(`${pkg.cardId}: aprovação ativa diverge do pacote aprovado`);
    }
    if (active.length > 1) throw new Error(`${pkg.cardId}: há aprovações ativas duplicadas`);
    if (active.length === 0) missing.push(pkg);
  }

  if (!commit) {
    console.log(JSON.stringify({ mode: "dry-run", writes: 0, cutoverReady: cutover.ready, cards: 4, slides: 32,
      matchingApprovals: 4 - missing.length, approvalsToRegister: missing.length,
      dimensions: "1080x1350", dmKeywordWrites: 0 }));
    return;
  }
  if (missing.length) {
    const sqlFile = path.join(tempRoot, "owner-derived-approvals.sql");
    try {
      await writeFile(sqlFile, buildOwnerApprovalSql(account.id, missing), "utf8");
      runSupabase(["db", "query", "--workdir", workdir, "--linked", "--file", sqlFile]);
    } finally {
      const resolved = path.resolve(tempRoot);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("instagram-carousel-approval-")) {
        throw new Error("Approval SQL temp folder is outside its exact OS temp root");
      }
    }
  }
  const verified = query(`select content_id,fingerprint,account_id,approved_by,revoked_at from dmflow.approved_content where content_type='carousel' and account_id=${sqlQuote(account.id)} and content_id=any(array[${cardIds}]::text[]) order by content_id`);
  const allMatch = packages.every((pkg) => verified.filter((row) => row.content_id === pkg.cardId &&
    row.fingerprint === pkg.fingerprint && row.account_id === account.id && row.approved_by === account.owner_user_id && row.revoked_at === null).length === 1);
  if (!allMatch) throw new Error("Owner-derived approvals did not verify as exactly four immutable records");
  console.log(JSON.stringify({ mode: "commit", ok: true, approvals: 4, slides: 32, dmKeywordWrites: 0 }));
  } finally {
    await cleanupTempRoot(tempRoot, "instagram-carousel-approval-");
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(`Carousel approval registration stopped: ${error instanceof Error ? error.message : "unknown error"}`); process.exitCode = 1; });
}
