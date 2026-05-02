import crypto from "crypto";
import { supabaseAdmin } from "./supabase";

type DispatchInput = {
  accountId: string;
  webhookUrl: string;
  webhookSecret?: string | null;
  eventType: string;
  payload: Record<string, any>;
};

/**
 * Fires a POST to the configured outgoing webhook with HMAC signature.
 * Signature header: x-dmflow-signature-256 = sha256=<hex>
 * Non-blocking: logs outcome to dmflow.outgoing_webhook_deliveries.
 */
export async function dispatchOutgoing(input: DispatchInput): Promise<void> {
  const sb = supabaseAdmin();
  const body = JSON.stringify({
    event: input.eventType,
    delivered_at: new Date().toISOString(),
    account_id: input.accountId,
    data: input.payload,
  });

  const started = Date.now();
  let status = 0;
  let errorMsg: string | null = null;

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-dmflow-event": input.eventType,
      "x-dmflow-delivery": crypto.randomBytes(8).toString("hex"),
      "user-agent": "dmflow-webhook/1.0",
    };
    if (input.webhookSecret) {
      const sig = crypto
        .createHmac("sha256", input.webhookSecret)
        .update(body)
        .digest("hex");
      headers["x-dmflow-signature-256"] = `sha256=${sig}`;
    }

    const res = await fetch(input.webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    });
    status = res.status;
    if (!res.ok) {
      errorMsg = `HTTP ${res.status}`;
    }
  } catch (e) {
    errorMsg = (e as Error).message;
  }

  await sb.from("outgoing_webhook_deliveries").insert({
    account_id: input.accountId,
    event_type: input.eventType,
    payload: JSON.parse(body),
    url: input.webhookUrl,
    status,
    response_ms: Date.now() - started,
    error: errorMsg,
  });
}
