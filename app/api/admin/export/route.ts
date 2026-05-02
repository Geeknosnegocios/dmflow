import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  if (/[,"\n]/.test(s)) return `"${s}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "events";
  const sb = supabaseAdmin();

  if (kind === "events") {
    const { data } = await sb
      .from("events")
      .select(
        "created_at, ig_username, ig_user_id, comment_text, matched_keyword, ig_media_id, public_reply_sent, public_reply_error, dm_sent, dm_error, rule_id"
      )
      .order("created_at", { ascending: false })
      .limit(10000);

    const rows = (data ?? []) as any[];
    const header = [
      "created_at",
      "ig_username",
      "ig_user_id",
      "comment_text",
      "matched_keyword",
      "ig_media_id",
      "public_reply_sent",
      "public_reply_error",
      "dm_sent",
      "dm_error",
      "rule_id",
    ];
    const csv = [header.join(",")]
      .concat(rows.map((r) => header.map((h) => csvEscape(r[h])).join(",")))
      .join("\n");

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="dmflow_events_${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  }

  if (kind === "clicks") {
    const { data } = await sb
      .from("tracked_links")
      .select(
        "id, created_at, rule_id, button_title, target_url, click_count, first_clicked_at, last_clicked_at, ig_user_id"
      )
      .order("created_at", { ascending: false })
      .limit(10000);

    const rows = (data ?? []) as any[];
    const header = [
      "id",
      "created_at",
      "rule_id",
      "button_title",
      "target_url",
      "click_count",
      "first_clicked_at",
      "last_clicked_at",
      "ig_user_id",
    ];
    const csv = [header.join(",")]
      .concat(rows.map((r) => header.map((h) => csvEscape(r[h])).join(",")))
      .join("\n");

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="dmflow_clicks_${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json(
    { error: "unknown kind", allowed: ["events", "clicks"] },
    { status: 400 }
  );
}
