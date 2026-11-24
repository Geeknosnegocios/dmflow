import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { supabaseServer } from "@/lib/supabase-server";
import { isOwnInstagramComment, permitsTestComment } from "@/lib/comment-rules";
import { matchRule } from "@/lib/match";
import { sendPrivateReply } from "@/lib/meta";
import { interpolate } from "@/lib/placeholders";
import type { Account, Rule } from "@/types/db";

export const runtime = "nodejs";
export const maxDuration = 120;

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_MS = 10 * 60 * 1000;
const BATCH_LIMIT = 15;
const GRAPH = "https://graph.instagram.com/v25.0";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mediaId = /^\d{1,32}$/;
type Comment = { id: string; text: string; timestamp: string; from?: { id?: string; username?: string } };

function signature(payload: string, key: string) {
  return createHmac("sha256", key).update("dmflow-retroactive-comments\0").update(payload).digest("hex");
}

async function graphRead(path: string, params: URLSearchParams, token: string) {
  const response = await fetch(`${GRAPH}/${path}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Instagram Graph read failed");
  return response.json();
}

function matches(rule: Rule, account: Account, comment: Comment) {
  const age = Date.now() - Date.parse(comment.timestamp);
  return actorCanReceive(comment) && Number.isFinite(age) && age >= 0 && age < WINDOW_MS &&
    !isOwnInstagramComment(comment.from, account) &&
    permitsTestComment(rule, comment.from, process.env.DMFLOW_TEST_COMMENTERS) &&
    matchRule(comment.text, rule);
}

function actorCanReceive(comment: Comment) {
  return mediaId.test(comment.id) && Boolean(comment.from?.id && comment.from.username) &&
    typeof comment.text === "string";
}

export async function POST(req: NextRequest) {
  const session = await supabaseServer();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const postId = body?.post_id;
  const ruleId = body?.rule_id;
  const mode = body?.action;
  if (typeof postId !== "string" || !mediaId.test(postId) || typeof ruleId !== "string" ||
      !uuid.test(ruleId) || !["preview", "send"].includes(mode)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  const db = supabaseAdmin();
  const { data: rule } = await db.from("rules").select("*").eq("id", ruleId)
    .eq("trigger_type", "comment").eq("platform", "instagram").eq("active", true).maybeSingle<Rule>();
  if (!rule || !rule.keyword || rule.match_mode === "any" || (rule.post_id && rule.post_id !== postId)) {
    return NextResponse.json({ error: "rule unavailable" }, { status: 404 });
  }
  const { data: account } = await db.from("accounts").select("*").eq("id", rule.account_id)
    .eq("owner_user_id", user.id).eq("active", true).maybeSingle<Account>();
  if (!account) return NextResponse.json({ error: "account unavailable" }, { status: 404 });

  // A preview can authorize only the same message, rule and post that the owner reviewed.
  const revision = createHash("sha256").update(JSON.stringify([
    rule.id, rule.account_id, rule.keyword, rule.match_mode, rule.post_id, rule.test_mode,
    rule.dm_message, rule.dm_button_url, rule.dm_button_text, rule.dm_buttons,
  ])).digest("hex");
  let confirmedIds: string[] = [];
  let expiresAt = 0;
  if (mode === "send") {
    confirmedIds = body.comment_ids;
    expiresAt = body.expires_at;
    if (body.confirm !== true || !Array.isArray(confirmedIds) || !confirmedIds.length ||
        confirmedIds.length > BATCH_LIMIT || confirmedIds.some((id) => typeof id !== "string" || !mediaId.test(id)) ||
        new Set(confirmedIds).size !== confirmedIds.length || !Number.isSafeInteger(expiresAt) ||
        expiresAt <= Date.now() || typeof body.confirmation !== "string" || !/^[0-9a-f]{64}$/.test(body.confirmation)) {
      return NextResponse.json({ error: "preview and explicit confirmation required" }, { status: 400 });
    }
    const expected = signature(JSON.stringify([user.id, revision, postId, expiresAt, confirmedIds]), key);
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(body.confirmation, "hex"))) {
      return NextResponse.json({ error: "preview no longer matches" }, { status: 409 });
    }
  }

  try {
    const owner = await graphRead(postId, new URLSearchParams({ fields: "id,owner" }), account.ig_access_token);
    const identity = await graphRead("me", new URLSearchParams({ fields: "id,user_id" }), account.ig_access_token);
    if (owner.id !== postId || !owner.owner?.id ||
        ![identity.id, identity.user_id, account.ig_business_id].includes(owner.owner.id)) {
      return NextResponse.json({ error: "post unavailable for this account" }, { status: 404 });
    }

    if (mode === "preview") {
      const comments: Comment[] = [];
      let after: string | undefined;
      let more = false;
      for (let page = 0; page < 5; page += 1) {
        const params = new URLSearchParams({ fields: "id,text,timestamp,from", limit: "50" });
        if (after) params.set("after", after);
        const result = await graphRead(`${postId}/comments`, params, account.ig_access_token);
        const eligible = (result.data ?? []).filter((comment: Comment) => matches(rule, account, comment)) as Comment[];
        if (eligible.length) {
          const logged = await db.from("events").select("ig_comment_id,rule_id,dm_sent,dm_error")
            .in("ig_comment_id", eligible.map((comment) => comment.id));
          if (logged.error) throw logged.error;
          const attempted = new Set(logged.data.filter((row) => row.rule_id || row.dm_sent || row.dm_error)
            .map((row) => row.ig_comment_id));
          for (const comment of eligible) {
            if (!attempted.has(comment.id) && !comments.some((item) => item.id === comment.id)) comments.push(comment);
          }
        }
        after = result.paging?.next ? result.paging?.cursors?.after : undefined;
        more = Boolean(after);
        if (!more || comments.length >= BATCH_LIMIT) break;
      }
      const batch = comments.slice(0, BATCH_LIMIT);
      const commentIds = batch.map((comment) => comment.id);
      expiresAt = Date.now() + PREVIEW_MS;
      return NextResponse.json({
        comments: batch, rule_id: rule.id, post_id: postId, comment_ids: commentIds,
        message: rule.dm_message, buttons: rule.dm_buttons ?? [],
        more: more || comments.length > BATCH_LIMIT,
        expires_at: expiresAt,
        confirmation: signature(JSON.stringify([user.id, revision, postId, expiresAt, commentIds]), key),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const results: Array<{ id: string; status: string }> = [];
    for (const id of confirmedIds) {
      const params = new URLSearchParams({ fields: "id,text,timestamp,from" });
      const comment = await graphRead(id, params, account.ig_access_token) as Comment;
      if (comment.id !== id || !matches(rule, account, comment)) {
        results.push({ id, status: "ineligible" });
        continue;
      }
      // A claim remains recorded after a failed/uncertain Graph request. Never resend it automatically.
      const event = {
        account_id: account.id, rule_id: rule.id, ig_comment_id: id, ig_media_id: postId,
        ig_user_id: comment.from?.id, ig_username: comment.from?.username, comment_text: comment.text,
        matched_keyword: rule.keyword, public_reply_sent: false, dm_sent: false,
        dm_error: "retroactive_attempt_pending", platform: "instagram",
      };
      const inserted = await db.from("events").upsert(event, { onConflict: "ig_comment_id", ignoreDuplicates: true })
        .select("id").maybeSingle();
      if (inserted.error) throw inserted.error;
      const claim = inserted.data ? inserted : await db.from("events")
        .update({ rule_id: rule.id, matched_keyword: rule.keyword, dm_error: event.dm_error })
        .eq("ig_comment_id", id).eq("account_id", account.id).eq("ig_media_id", postId)
        .is("rule_id", null).eq("dm_sent", false).is("dm_error", null).select("id").maybeSingle();
      if (claim.error) throw claim.error;
      if (!claim.data) {
        results.push({ id, status: "already_handled" });
        continue;
      }
      const result = await sendPrivateReply({
        commentId: id, message: interpolate(rule.dm_message, { username: comment.from?.username ?? null }),
        buttons: rule.dm_buttons, buttonUrl: rule.dm_button_url, buttonText: rule.dm_button_text,
        accessToken: account.ig_access_token,
      });
      const saved = await db.from("events").update({
        dm_sent: result.ok, dm_error: result.ok ? null : "retroactive_needs_review",
      }).eq("id", claim.data.id);
      if (saved.error) throw saved.error;
      results.push({ id, status: result.ok ? "sent" : "needs_review" });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "operation interrupted; review event status before retrying" }, { status: 502 });
  }
}
