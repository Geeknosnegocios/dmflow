import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendNotification } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
  if (isVercelCron) return true;
  if (!secret || secret.length === 0) return true;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

/**
 * Checa nas últimas 24h:
 *  - % de DM failures (se > 30% e >= 5 tentativas, alerta)
 *  - tokens expirando em < 7 dias
 *  - qualquer signature_valid=false recente (possível config errada)
 */
export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [eventsRes, accountsRes, sigRes] = await Promise.all([
    sb
      .from("events")
      .select("dm_sent, dm_error, public_reply_error")
      .gte("created_at", since),
    sb
      .from("accounts")
      .select("id, name, ig_business_id, ig_token_expires_at, notify_email")
      .eq("active", true),
    sb
      .from("raw_webhooks")
      .select("id")
      .eq("signature_valid", false)
      .gte("received_at", since),
  ]);

  const events = (eventsRes.data ?? []) as any[];
  const accounts = (accountsRes.data ?? []) as any[];
  const sigFailures = (sigRes.data ?? []).length;

  const dmAttempts = events.filter(
    (e) => e.dm_sent === true || e.dm_error !== null
  );
  const dmFailures = events.filter((e) => e.dm_error !== null);
  const failureRate =
    dmAttempts.length > 0 ? dmFailures.length / dmAttempts.length : 0;

  const alerts: string[] = [];

  if (dmAttempts.length >= 5 && failureRate > 0.3) {
    alerts.push(
      `📉 <b>${(failureRate * 100).toFixed(0)}% de DMs falharam</b> nas últimas 24h (${dmFailures.length}/${dmAttempts.length}). Pode ser rate limit ou token quebrado.`
    );
  }

  if (sigFailures > 0) {
    alerts.push(
      `🔐 <b>${sigFailures} webhooks com assinatura inválida</b>. Verifique app_secret ou configuração no Meta Dashboard.`
    );
  }

  const soonExpiring = accounts.filter((a) => {
    if (!a.ig_token_expires_at) return false;
    const diffDays =
      (new Date(a.ig_token_expires_at).getTime() - Date.now()) / 86400000;
    return diffDays < 7;
  });
  for (const a of soonExpiring) {
    const days = Math.round(
      (new Date(a.ig_token_expires_at).getTime() - Date.now()) / 86400000
    );
    alerts.push(
      `⏰ Token de <b>${a.name}</b> expira em <b>${days} dia(s)</b>. Refresh automático deve resolver — se não, gere novo manualmente.`
    );
  }

  let sent = false;
  if (alerts.length > 0) {
    sent = await sendNotification({
      subject: `⚠️ DMFlow — ${alerts.length} alerta(s)`,
      html: `<h2>Alertas DMFlow — últimas 24h</h2>
        <ul>${alerts.map((a) => `<li>${a}</li>`).join("")}</ul>
        <hr/>
        <p><b>Stats 24h:</b> ${events.length} eventos · ${dmFailures.length} falhas · ${sigFailures} webhooks inválidos</p>
        <p><a href="https://dmflow.vercel.app/dashboard">Abrir dashboard</a></p>`,
    });
  }

  return NextResponse.json({
    checked_events: events.length,
    dm_attempts: dmAttempts.length,
    dm_failures: dmFailures.length,
    failure_rate: `${(failureRate * 100).toFixed(1)}%`,
    signature_failures: sigFailures,
    tokens_soon_expiring: soonExpiring.length,
    alerts_count: alerts.length,
    notification_sent: sent,
  });
}
