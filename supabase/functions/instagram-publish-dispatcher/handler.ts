export type Lane = "carousel" | "reel" | "reel_story" | "metadata";
type Claim = { claim_token: string; lane: Lane };
type Config = { supabaseUrl: string; serviceRoleKey: string; dispatcherTokenSha256: string };
type Repository = { claim(now: number): Promise<Claim | null>; release(token: string, now: number): Promise<boolean> };
type Dependencies = { config: Config; repository: Repository | (() => Repository); fetchImpl?: typeof fetch; now?: () => number };

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function validConfig(config: Config) {
  if (!config.supabaseUrl || !config.serviceRoleKey || !/^[0-9a-f]{64}$/i.test(config.dispatcherTokenSha256)) return false;
  try { return new URL(config.supabaseUrl).origin === "https://zoknypleoribwomifzgi.supabase.co"; }
  catch { return false; }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index++) {
    difference |= left.toLowerCase().charCodeAt(index) ^ right.toLowerCase().charCodeAt(index);
  }
  return difference === 0;
}

function workerRequest(lane: Lane) {
  if (lane === "carousel") return { name: "publish-carousel", body: {} };
  if (lane === "reel") return { name: "publish-reel", body: { mode: "reel" } };
  if (lane === "reel_story") return { name: "publish-reel", body: { mode: "story" } };
  return { name: "publish-reel", body: { mode: "metadata" } };
}

function safeStatus(payload: unknown) {
  if (typeof payload === "object" && payload !== null && "status" in payload && typeof payload.status === "string" &&
      ["published", "pending", "metadata_pending", "not_claimed", "not_eligible", "rejected", "needs_reconciliation"].includes(payload.status)) {
    return payload.status;
  }
  return "unknown";
}

export function createInstagramPublishDispatcher({ config, repository, fetchImpl = fetch, now = Date.now }: Dependencies) {
  return async function handle(request: Request) {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (!validConfig(config)) return json({ error: "dispatcher is not configured" }, 503);
    const supplied = request.headers.get("x-instagram-dispatcher-token") ?? "";
    if (!supplied || !constantTimeEqual(await sha256(supplied), config.dispatcherTokenSha256)) {
      return json({ error: "unauthorized" }, 401);
    }

    const repo = typeof repository === "function" ? repository() : repository;
    const started = now();
    let claim: Claim | null;
    try { claim = await repo.claim(started); }
    catch { return json({ error: "dispatcher claim failed" }, 503); }
    if (!claim) return json({ ok: true, status: "idle" });

    let result = { status: "worker_error", http_status: 0 };
    try {
      const target = workerRequest(claim.lane);
      const endpoint = new URL(`/functions/v1/${target.name}`, config.supabaseUrl);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.serviceRoleKey}`,
          apikey: config.serviceRoleKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(target.body),
        signal: AbortSignal.timeout(90_000),
      });
      result = { status: "worker_error", http_status: response.status };
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        result = { status: safeStatus(payload), http_status: response.status };
      }
    } catch {
      result = { status: "worker_unavailable", http_status: 0 };
    }

    try {
      if (!await repo.release(claim.claim_token, now())) {
        return json({ ...result, ok: false, status: "lease_expired", lane: claim.lane }, 503);
      }
    } catch {
      return json({ ...result, ok: false, status: "release_failed", lane: claim.lane }, 503);
    }
    const ok = result.http_status >= 200 && result.http_status < 300;
    return json({ ok, lane: claim.lane, ...result }, ok ? 200 : 502);
  };
}
