import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyMetaSignature } from "@/lib/signature";
import { pickRule } from "@/lib/match";
import { replyToComment, sendPrivateReply, sendDirectMessage } from "@/lib/meta";
import { buildTrackedButtons, resolveBaseUrl, TrackedButton } from "@/lib/tracking";
import { interpolate } from "@/lib/placeholders";
import { dispatchOutgoing } from "@/lib/outgoing-webhook";
import { checkSentimentFilter } from "@/lib/sentiment";
import { pickVariant } from "@/lib/variant-picker";
import type { Account, Rule } from "@/types/db";

function collectButtons(rule: Rule): TrackedButton[] {
  if (Array.isArray(rule.dm_buttons) && rule.dm_buttons.length > 0) {
    return rule.dm_buttons.map((b) => ({ url: b.url, title: b.title }));
  }
  if (rule.dm_button_url && rule.dm_button_text) {
    return [{ url: rule.dm_button_url, title: rule.dm_button_text }];
  }
  return [];
}

function maybeFireWebhook(
  account: Account,
  eventType: string,
  payload: Record<string, any>
) {
  if (!account.outgoing_webhook_url) return;
  const events = account.outgoing_webhook_events ?? ["event.created"];
  if (!events.includes(eventType) && !events.includes("*")) return;
  // fire and forget
  dispatchOutgoing({
    accountId: account.id,
    webhookUrl: account.outgoing_webhook_url,
    webhookSecret: account.outgoing_webhook_secret,
    eventType,
    payload,
  }).catch(() => {});
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return new NextResponse("bad request", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("accounts")
    .select("id")
    .eq("verify_token", token)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return new NextResponse("forbidden", { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const sb = supabaseAdmin();
  const baseUrl = resolveBaseUrl(req);

  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headersObj[k] = v;
  });

  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // keep null
  }

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const firstEntry = entries[0];
  const firstChange =
    firstEntry?.changes?.[0] ??
    (firstEntry?.messaging ? { field: "messaging" } : null);

  await sb.from("raw_webhooks").insert({
    ig_object_id: firstEntry?.id ?? null,
    signature_header: signature,
    signature_valid: null,
    field: firstChange?.field ?? null,
    value_type: firstChange?.value ? typeof firstChange.value : null,
    raw_body: rawBody.slice(0, 8000),
    headers: headersObj,
  });

  if (!payload) return NextResponse.json({ ok: true });

  for (const entry of entries) {
    const igObjectId: string | undefined = entry?.id;
    if (!igObjectId) continue;

    const { data: account } = await sb
      .from("accounts")
      .select("*")
      .eq("ig_business_id", igObjectId)
      .eq("active", true)
      .limit(1)
      .maybeSingle<Account>();

    if (!account) continue;

    const sigValid = verifyMetaSignature(rawBody, signature, account.app_secret);
    await sb
      .from("raw_webhooks")
      .update({ signature_valid: sigValid, matched_account_id: account.id })
      .eq("ig_object_id", igObjectId)
      .is("matched_account_id", null);

    if (!sigValid) {
      console.warn(`[dmflow] invalid signature for ${igObjectId}`);
      continue;
    }

    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (change.field === "comments") {
          await handleComment(sb, account, change.value || {}, baseUrl);
        }
      }
    }

    if (Array.isArray(entry.messaging)) {
      for (const msg of entry.messaging) {
        await handleMessage(sb, account, msg, baseUrl);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleComment(
  sb: any,
  account: Account,
  value: any,
  baseUrl: string
) {
  const commentId: string | undefined = value.id;
  if (!commentId) return;

  const commentText: string = value.text ?? "";
  const mediaId: string | undefined = value.media?.id;
  const originalMediaId: string | undefined = value.media?.original_media_id;

  const { data: existing } = await sb
    .from("events")
    .select("id")
    .eq("ig_comment_id", commentId)
    .maybeSingle();
  if (existing) return;

  const { data: allRulesRaw } = await sb
    .from("rules")
    .select("*")
    .eq("account_id", account.id)
    .eq("active", true)
    .eq("trigger_type", "comment");
  const allRules = (allRulesRaw ?? []) as Rule[];
  const rules = allRules.filter(
    (r) => !r.post_id ||
      (mediaId && r.post_id === mediaId) ||
      (originalMediaId && r.post_id === originalMediaId)
  );

  const rule = pickRule(commentText, rules);

  // Sentiment filter — skip if negative (only if enabled + rule matched)
  if (rule && account.sentiment_filter_enabled && commentText.length > 0) {
    const filter = await checkSentimentFilter({
      accountId: account.id,
      minConfidence: account.sentiment_min_confidence ?? 0.7,
      commentText,
    });
    if (filter.shouldBlock) {
      await sb.from("events").insert({
        account_id: account.id,
        rule_id: rule.id,
        ig_comment_id: commentId,
        ig_media_id: mediaId ?? null,
        ig_user_id: value.from?.id ?? null,
        ig_username: value.from?.username ?? null,
        comment_text: commentText,
        matched_keyword: rule.keyword,
        public_reply_sent: false,
        dm_sent: false,
        dm_error: `sentiment_blocked: ${filter.result?.label} ${filter.result?.confidence.toFixed(2)}`,
        raw_payload: value,
      });
      return;
    }
  }

  // Cria event primeiro (sem outcome) pra ter event_id pros tracked links
  const { data: eventRow } = await sb
    .from("events")
    .insert({
      account_id: account.id,
      rule_id: rule?.id ?? null,
      ig_comment_id: commentId,
      ig_media_id: mediaId ?? null,
      ig_user_id: value.from?.id ?? null,
      ig_username: value.from?.username ?? null,
      comment_text: commentText,
      matched_keyword: rule?.keyword ?? null,
      public_reply_sent: false,
      dm_sent: false,
      raw_payload: value,
    })
    .select("id")
    .single();

  const eventId = eventRow?.id;

  let publicReplySent = false;
  let publicReplyError: string | null = null;
  let dmSent = false;
  let dmError: string | null = null;

  if (rule) {
    if (rule.public_reply && rule.public_reply.trim()) {
      const r = await replyToComment({
        commentId,
        message: rule.public_reply,
        accessToken: account.ig_access_token,
      });
      publicReplySent = r.ok;
      if (!r.ok) publicReplyError = r.error;
    }

    const picked = pickVariant(rule);
    const originalButtons =
      picked.buttons && picked.buttons.length > 0
        ? picked.buttons
        : collectButtons(rule);

    const trackedButtons =
      originalButtons.length > 0
        ? await buildTrackedButtons({
            buttons: originalButtons,
            accountId: account.id,
            ruleId: rule.id,
            eventId,
            igUserId: value.from?.id,
            baseUrl,
          })
        : [];

    const personalizedMsg = interpolate(picked.message, {
      username: value.from?.username ?? null,
    });

    const dm = await sendPrivateReply({
      commentId,
      message: personalizedMsg,
      buttons: trackedButtons.length > 0 ? trackedButtons : null,
      accessToken: account.ig_access_token,
    });
    dmSent = dm.ok;
    if (!dm.ok) dmError = dm.error;

    // Track variant hit
    if (picked.variant_index !== null && dmSent) {
      const hits = [...(rule.variant_hits ?? [])];
      while (hits.length <= picked.variant_index) hits.push(0);
      hits[picked.variant_index] = (hits[picked.variant_index] ?? 0) + 1;
      await sb.from("rules").update({ variant_hits: hits }).eq("id", rule.id);
      if (eventId) {
        await sb
          .from("events")
          .update({ variant_index: picked.variant_index })
          .eq("id", eventId);
      }
    }

    if (dmSent || publicReplySent) {
      await sb
        .from("rules")
        .update({ triggered_count: rule.triggered_count + 1 })
        .eq("id", rule.id);
    }
  }

  if (eventId) {
    await sb
      .from("events")
      .update({
        public_reply_sent: publicReplySent,
        public_reply_error: publicReplyError,
        dm_sent: dmSent,
        dm_error: dmError,
      })
      .eq("id", eventId);
  }

  // Schedule follow-up if configured
  if (rule && rule.followup_delay_hours && rule.followup_message && eventId && value.from?.id) {
    const scheduled = new Date(
      Date.now() + rule.followup_delay_hours * 3600 * 1000
    ).toISOString();
    await sb.from("followups").insert({
      event_id: eventId,
      rule_id: rule.id,
      account_id: account.id,
      ig_user_id: value.from.id,
      scheduled_for: scheduled,
    });
  }

  // Fire outgoing webhook
  maybeFireWebhook(account, "event.created", {
    event_id: eventId,
    rule_id: rule?.id ?? null,
    rule_name: rule?.name ?? null,
    trigger_type: "comment",
    ig_comment_id: commentId,
    ig_user_id: value.from?.id ?? null,
    ig_username: value.from?.username ?? null,
    comment_text: commentText,
    matched_keyword: rule?.keyword ?? null,
    dm_sent: dmSent,
    public_reply_sent: publicReplySent,
  });
}

function detectStoryReply(message: any): { isStoryReply: boolean; storyId: string | null; storyUrl: string | null } {
  if (!message) return { isStoryReply: false, storyId: null, storyUrl: null };

  // Format 1: message.reply_to.story
  const replyStory = message.reply_to?.story;
  if (replyStory) {
    return {
      isStoryReply: true,
      storyId: replyStory.id ?? null,
      storyUrl: replyStory.url ?? null,
    };
  }

  // Format 2: attachments[].type === "story_mention"
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const a of attachments) {
    if (a?.type === "story_mention") {
      return {
        isStoryReply: true,
        storyId: a.payload?.id ?? null,
        storyUrl: a.payload?.url ?? null,
      };
    }
  }

  return { isStoryReply: false, storyId: null, storyUrl: null };
}

async function handleMessage(
  sb: any,
  account: Account,
  msg: any,
  baseUrl: string
) {
  const senderId: string | undefined = msg.sender?.id;
  const recipientId: string | undefined = msg.recipient?.id;
  if (!senderId || !recipientId) return;

  // Skip echoes (messages sent BY the account)
  if (senderId === account.ig_business_id || msg.message?.is_echo) return;

  // Skip read receipts, reactions, etc — only process real messages
  if (!msg.message || msg.message.is_deleted) return;

  const messageMid: string | undefined = msg.message?.mid;
  const messageText: string = msg.message?.text ?? "";
  const storyMeta = detectStoryReply(msg.message);

  // Upsert sender record — track if first-time DM
  const { data: existingSender } = await sb
    .from("dm_senders")
    .select("ig_user_id, message_count")
    .eq("account_id", account.id)
    .eq("ig_user_id", senderId)
    .maybeSingle();

  const isFirstDm = !existingSender;

  if (existingSender) {
    await sb
      .from("dm_senders")
      .update({ message_count: existingSender.message_count + 1 })
      .eq("account_id", account.id)
      .eq("ig_user_id", senderId);
  } else {
    await sb
      .from("dm_senders")
      .insert({ account_id: account.id, ig_user_id: senderId });
  }

  // Priority: story_reply > first_dm welcome
  let rule: Rule | null = null;
  let matchedKeyword: string | null = null;

  if (storyMeta.isStoryReply) {
    const { data: storyRulesRaw } = await sb
      .from("rules")
      .select("*")
      .eq("account_id", account.id)
      .eq("active", true)
      .eq("trigger_type", "story_reply")
      .order("priority", { ascending: false });
    const storyRules = ((storyRulesRaw ?? []) as Rule[]).filter(
      (r) => !r.story_id || r.story_id === storyMeta.storyId
    );

    for (const candidate of storyRules) {
      if (candidate.match_mode === "any") {
        rule = candidate;
        matchedKeyword = "[story_any]";
        break;
      }
      if (candidate.keyword && messageText) {
        const text = messageText.toLowerCase();
        const kw = candidate.keyword.toLowerCase();
        if (
          (candidate.match_mode === "contains" && text.includes(kw)) ||
          (candidate.match_mode === "exact" && text === kw) ||
          (candidate.match_mode === "starts_with" && text.startsWith(kw))
        ) {
          rule = candidate;
          matchedKeyword = candidate.keyword;
          break;
        }
      }
    }
  }

  if (!rule && isFirstDm) {
    const { data: welcomeRulesRaw } = await sb
      .from("rules")
      .select("*")
      .eq("account_id", account.id)
      .eq("active", true)
      .eq("trigger_type", "first_dm")
      .order("priority", { ascending: false })
      .limit(1);
    rule = ((welcomeRulesRaw ?? []) as Rule[])[0] ?? null;
    if (rule) matchedKeyword = "[first_dm]";
  }

  const welcome = rule;
  if (!welcome) return;

  // Cria event primeiro pra ter event_id
  const { data: eventRow } = await sb
    .from("events")
    .insert({
      account_id: account.id,
      rule_id: welcome.id,
      ig_comment_id: messageMid ?? `dm_${senderId}_${Date.now()}`,
      ig_media_id: storyMeta.storyId ?? null,
      ig_user_id: senderId,
      ig_username: null,
      comment_text: messageText,
      matched_keyword: matchedKeyword,
      public_reply_sent: false,
      dm_sent: false,
      raw_payload: msg,
    })
    .select("id")
    .single();

  const eventId = eventRow?.id;

  const originalButtons = collectButtons(welcome);
  const trackedButtons =
    originalButtons.length > 0
      ? await buildTrackedButtons({
          buttons: originalButtons,
          accountId: account.id,
          ruleId: welcome.id,
          eventId,
          igUserId: senderId,
          baseUrl,
        })
      : [];

  // Fetch sender username best-effort via Graph (optional; safe to fail)
  let senderUsername: string | null = null;
  try {
    const ures = await fetch(
      `https://graph.instagram.com/v25.0/${senderId}?fields=username`,
      { headers: { Authorization: `Bearer ${account.ig_access_token}` } }
    );
    if (ures.ok) senderUsername = (await ures.json())?.username ?? null;
  } catch {}

  const personalizedMsg = interpolate(welcome.dm_message, {
    username: senderUsername,
  });

  const dm = await sendDirectMessage({
    recipientId: senderId,
    message: personalizedMsg,
    buttons: trackedButtons.length > 0 ? trackedButtons : null,
    accessToken: account.ig_access_token,
  });
  const dmSent = dm.ok;
  const dmError = dm.ok ? null : dm.error;

  if (dmSent) {
    await sb
      .from("rules")
      .update({ triggered_count: welcome.triggered_count + 1 })
      .eq("id", welcome.id);
  }

  if (eventId) {
    await sb
      .from("events")
      .update({ dm_sent: dmSent, dm_error: dmError })
      .eq("id", eventId);
  }

  maybeFireWebhook(account, "event.created", {
    event_id: eventId,
    rule_id: welcome.id,
    rule_name: welcome.name,
    trigger_type: welcome.trigger_type,
    ig_user_id: senderId,
    ig_username: senderUsername,
    message_text: messageText,
    matched_keyword: matchedKeyword,
    dm_sent: dmSent,
  });
}
