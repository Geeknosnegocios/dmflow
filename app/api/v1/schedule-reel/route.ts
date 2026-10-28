import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Agendamento de Reels foi centralizado; este endpoint antigo foi desativado." },
    { status: 410 },
  );
}
