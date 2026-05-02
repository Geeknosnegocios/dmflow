import { NextRequest, NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/api-keys";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getAccountIds(userId: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("accounts").select("id").eq("owner_user_id", userId);
  return (data ?? []).map((a: any) => a.id);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyApiKey(token);
  if (!v.valid) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const { id } = await params;
  const accountIds = await getAccountIds(v.user_id!);
  if (!accountIds.length) return NextResponse.json({ error: "no account" }, { status: 400 });

  const body = await req.json();
  const allowed = ["name", "keyword", "match_mode", "dm_message", "active", "priority", "platform"];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];

  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("rules")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("account_id", accountIds)
    .select("id, name, keyword, active, platform")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const v = await verifyApiKey(token);
  if (!v.valid) return NextResponse.json({ error: "invalid api key" }, { status: 401 });

  const { id } = await params;
  const accountIds = await getAccountIds(v.user_id!);
  if (!accountIds.length) return NextResponse.json({ error: "no account" }, { status: 400 });

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("rules")
    .delete()
    .eq("id", id)
    .in("account_id", accountIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
