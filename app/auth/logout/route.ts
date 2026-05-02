import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  const url = new URL(req.url);
  return NextResponse.redirect(new URL("/", url.origin));
}

export async function POST(req: Request) {
  return GET(req);
}
