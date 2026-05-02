import { NextRequest, NextResponse } from "next/server";
import { refreshAllExpiring } from "@/lib/token-refresh";
import { sendNotification } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  if (isVercelCron) return true;
  if (!secret || secret.length === 0) return true; // allow if unset
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await refreshAllExpiring(14);

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    await sendNotification({
      subject: `🚨 DMFlow: ${failures.length} token(s) falharam no refresh`,
      html: `<h2>Falha ao renovar token(s) Instagram</h2>
        <p>Algum token não pôde ser renovado automaticamente. Se não for resolvido, o sistema para em até 14 dias.</p>
        <ul>
          ${failures
            .map(
              (f) =>
                `<li><b>${f.account_id}</b>: ${"error" in f ? f.error : ""}</li>`
            )
            .join("")}
        </ul>
        <p><a href="https://dmflow.vercel.app/dashboard">Abrir dashboard</a></p>`,
    });
  }

  return NextResponse.json({
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: failures.length,
    results,
  });
}
