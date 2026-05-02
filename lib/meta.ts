const IG_GRAPH = "https://graph.instagram.com/v25.0";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(
  url: string,
  init: RequestInit
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const msg =
        json?.error?.message || json?.error?.error_user_msg || res.statusText;
      return { ok: false, error: `HTTP ${res.status}: ${msg}` };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function replyToComment(params: {
  commentId: string;
  message: string;
  accessToken: string;
}): Promise<ApiResult<{ id: string }>> {
  return call(`${IG_GRAPH}/${params.commentId}/replies`, {
    method: "POST",
    headers: authHeaders(params.accessToken),
    body: JSON.stringify({ message: params.message }),
  });
}

type ButtonSpec = { url: string; title: string };

function buildMessagePayload(
  text: string,
  buttons: ButtonSpec[] | null | undefined
) {
  const cleaned = (buttons ?? []).filter(
    (b) => b.url && b.title && b.title.length <= 20
  );
  if (cleaned.length === 0) return { text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text,
        buttons: cleaned.slice(0, 3).map((b) => ({
          type: "web_url",
          url: b.url,
          title: b.title,
        })),
      },
    },
  };
}

export async function sendPrivateReply(params: {
  commentId: string;
  message: string;
  buttonUrl?: string | null;
  buttonText?: string | null;
  buttons?: ButtonSpec[] | null;
  accessToken: string;
}): Promise<ApiResult<{ recipient_id: string; message_id: string }>> {
  const btns =
    params.buttons && params.buttons.length > 0
      ? params.buttons
      : params.buttonUrl && params.buttonText
      ? [{ url: params.buttonUrl, title: params.buttonText }]
      : null;

  const body = {
    recipient: { comment_id: params.commentId },
    message: buildMessagePayload(params.message, btns),
  };

  return call(`${IG_GRAPH}/me/messages`, {
    method: "POST",
    headers: authHeaders(params.accessToken),
    body: JSON.stringify(body),
  });
}

export async function sendDirectMessage(params: {
  recipientId: string;
  message: string;
  buttonUrl?: string | null;
  buttonText?: string | null;
  buttons?: ButtonSpec[] | null;
  accessToken: string;
}): Promise<ApiResult<{ recipient_id: string; message_id: string }>> {
  const btns =
    params.buttons && params.buttons.length > 0
      ? params.buttons
      : params.buttonUrl && params.buttonText
      ? [{ url: params.buttonUrl, title: params.buttonText }]
      : null;

  const body = {
    recipient: { id: params.recipientId },
    message: buildMessagePayload(params.message, btns),
  };

  return call(`${IG_GRAPH}/me/messages`, {
    method: "POST",
    headers: authHeaders(params.accessToken),
    body: JSON.stringify(body),
  });
}

export async function subscribeApp(params: {
  accessToken: string;
  fields?: string[];
}): Promise<ApiResult<{ success: boolean }>> {
  const fields = (params.fields ?? ["comments", "messages"]).join(",");
  return call(
    `${IG_GRAPH}/me/subscribed_apps?subscribed_fields=${encodeURIComponent(fields)}`,
    {
      method: "POST",
      headers: authHeaders(params.accessToken),
    }
  );
}

export async function getSubscribedApps(params: {
  accessToken: string;
}): Promise<ApiResult<{ data: Array<{ name: string; subscribed_fields: string[] }> }>> {
  return call(`${IG_GRAPH}/me/subscribed_apps`, {
    method: "GET",
    headers: authHeaders(params.accessToken),
  });
}

export async function whoAmI(params: {
  accessToken: string;
}): Promise<ApiResult<{ id: string; username: string; account_type: string }>> {
  return call(
    `${IG_GRAPH}/me?fields=id,username,account_type`,
    {
      method: "GET",
      headers: authHeaders(params.accessToken),
    }
  );
}
