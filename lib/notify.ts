const BREVO_API = "https://api.brevo.com/v3/smtp/email";

export type NotifyInput = {
  subject: string;
  html: string;
  to?: string; // override default
};

export async function sendNotification(input: NotifyInput): Promise<boolean> {
  const key = process.env.BREVO_API_KEY;
  const to = input.to ?? process.env.NOTIFY_EMAIL;
  const fromEmail = process.env.NOTIFY_FROM_EMAIL ?? "no-reply@geekacademy.site";
  const fromName = process.env.NOTIFY_FROM_NAME ?? "DMFlow";

  if (!key || !to) {
    console.warn("[dmflow] notify skipped — missing BREVO_API_KEY or NOTIFY_EMAIL");
    return false;
  }

  try {
    const res = await fetch(BREVO_API, {
      method: "POST",
      headers: {
        "api-key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: to }],
        subject: input.subject,
        htmlContent: input.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[dmflow] notify failed: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[dmflow] notify error: ${(e as Error).message}`);
    return false;
  }
}
