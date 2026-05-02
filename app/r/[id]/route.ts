import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const sb = supabaseAdmin();

  const { data: link } = await sb
    .from("tracked_links")
    .select("id, target_url, click_count, rule_id, event_id")
    .eq("id", id)
    .maybeSingle();

  if (!link || !link.target_url) {
    return new NextResponse("link not found", { status: 404 });
  }

  const now = new Date().toISOString();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  const isFirstClick = (link.click_count ?? 0) === 0;

  await Promise.all([
    sb
      .from("tracked_links")
      .update({
        click_count: (link.click_count ?? 0) + 1,
        last_clicked_at: now,
        ...(isFirstClick ? { first_clicked_at: now } : {}),
      })
      .eq("id", id),
    sb.from("link_clicks").insert({
      tracked_link_id: id,
      ip,
      user_agent: req.headers.get("user-agent"),
      referer: req.headers.get("referer"),
    }),
  ]);

  // Mark variant conversion on first click
  if (isFirstClick && link.rule_id && link.event_id) {
    const { data: event } = await sb
      .from("events")
      .select("variant_index")
      .eq("id", link.event_id)
      .maybeSingle();
    if (event?.variant_index !== null && event?.variant_index !== undefined) {
      const { data: rule } = await sb
        .from("rules")
        .select("variant_conversions")
        .eq("id", link.rule_id)
        .maybeSingle();
      const convs = [...((rule?.variant_conversions as number[]) ?? [])];
      while (convs.length <= event.variant_index) convs.push(0);
      convs[event.variant_index] = (convs[event.variant_index] ?? 0) + 1;
      await sb
        .from("rules")
        .update({ variant_conversions: convs })
        .eq("id", link.rule_id);
    }
  }

  return NextResponse.redirect(link.target_url, 302);
}
