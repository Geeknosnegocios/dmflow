import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lastlink webhook — handles purchase/subscription events.
 *
 * Expected event types (adapt to whatever Lastlink actually sends):
 *   - Purchase_Order_Confirmed
 *   - Subscription_Canceled
 *   - Subscription_Renewed
 *
 * We map `Product.Id` or `Product.Name` to our internal `plan_slug`
 * via env `LASTLINK_PRODUCT_MAP` (JSON string):
 *   { "prod_abc123": "pro", "prod_xyz789": "business" }
 */

function verifyHmac(body: string, signature: string | null): boolean {
  const secret = process.env.LASTLINK_WEBHOOK_SECRET;
  if (!secret) return true; // dev mode — accept all
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature.replace(/^sha256=/, ""))
    );
  } catch {
    return false;
  }
}

function productToPlan(productId: string | undefined, productName: string | undefined): string | null {
  try {
    const map = JSON.parse(process.env.LASTLINK_PRODUCT_MAP ?? "{}");
    if (productId && map[productId]) return map[productId];
    if (productName && map[productName]) return map[productName];
  } catch {}
  // Fallback: detect from product name
  const name = (productName ?? "").toLowerCase();
  if (name.includes("business")) return "business";
  if (name.includes("pro")) return "pro";
  return null;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-lastlink-signature-256") ?? req.headers.get("x-hub-signature-256");
  if (!verifyHmac(raw, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const event = payload.Event ?? payload.event ?? "";
  const email =
    payload?.Data?.Buyer?.Email ??
    payload?.Data?.Customer?.Email ??
    payload?.Buyer?.Email ??
    payload?.Customer?.Email;
  const productId = payload?.Data?.Products?.[0]?.Id ?? payload?.Product?.Id;
  const productName = payload?.Data?.Products?.[0]?.Name ?? payload?.Product?.Name;
  const amount =
    payload?.Data?.Purchase?.PaymentOrder?.Amount ??
    payload?.Purchase?.Amount ??
    null;

  if (!email) {
    await admin.from("subscription_events").insert({
      provider: "lastlink",
      status: "missing_email",
      raw_payload: payload,
    });
    return NextResponse.json({ ok: true, note: "no email" });
  }

  // Find user by email
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  const planSlug = productToPlan(productId, productName);

  const isPaid =
    event.includes("Purchase_Order_Confirmed") ||
    event.includes("Subscription_Renewed") ||
    event.includes("Subscription_Activated");
  const isCanceled = event.includes("Subscription_Canceled") || event.includes("Chargeback");

  await admin.from("subscription_events").insert({
    user_id: profile?.id ?? null,
    plan_slug: planSlug,
    provider: "lastlink",
    external_id: payload?.Id ?? payload?.Data?.Id ?? null,
    amount_brl: amount,
    status: isPaid ? "paid" : isCanceled ? "canceled" : event,
    raw_payload: payload,
  });

  if (profile && planSlug) {
    if (isPaid) {
      const expires = new Date(Date.now() + 31 * 86400 * 1000);
      await admin
        .from("user_profiles")
        .update({
          plan_slug: planSlug,
          subscription_status: "active",
          subscription_expires_at: expires.toISOString(),
        })
        .eq("id", profile.id);
    } else if (isCanceled) {
      await admin
        .from("user_profiles")
        .update({
          plan_slug: "free",
          subscription_status: "canceled",
        })
        .eq("id", profile.id);
    }
  }

  return NextResponse.json({ ok: true });
}
