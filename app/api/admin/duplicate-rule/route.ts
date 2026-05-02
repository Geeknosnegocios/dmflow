import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const ruleId = String(form.get("rule_id") ?? "");
  if (!ruleId) return NextResponse.json({ error: "rule_id required" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: original } = await sb
    .from("rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle();
  if (!original) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { id, created_at, updated_at, triggered_count, ...rest } = original as any;
  const copy = {
    ...rest,
    name: `${original.name} (cópia)`,
    active: false,
  };

  const { data: inserted, error } = await sb
    .from("rules")
    .insert(copy)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, new_rule_id: inserted?.id });
}
