import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "Instagram publishing was moved to the Geek Academy Supabase dispatcher." },
    { status: 410 },
  );
}
