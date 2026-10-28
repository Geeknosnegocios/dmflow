type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
type Account = {
  ig_username: string | null;
  ig_access_token: string;
  ig_token_expires_at: string | null;
};

export function assertAuthorizedInstagramAccount({ active, ig_username }: {
  active: boolean;
  ig_username: string | null;
}) {
  if (active !== true || ig_username !== "andreyogeek") {
    throw new Error("Instagram account is not active on the allowed publishing profile");
  }
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

async function readResponse(response: Response) {
  if (!response.ok) throw new Error(`Instagram Graph HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error("Instagram Graph rejected the request");
  return result;
}

export async function resolveInstagramIdentity({ graphVersion, now, account, fetchImpl = fetch, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }: {
  graphVersion: string;
  now: number;
  account: Account;
  fetchImpl?: Fetcher;
  requestTimeoutMs?: number;
}) {
  if (!account.ig_access_token || !account.ig_username) {
    throw new Error("Instagram account identity is unavailable");
  }
  const expiresAt = Date.parse(account.ig_token_expires_at ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("Instagram access token is expired");
  }
  const response = await fetchImpl(`https://graph.instagram.com/${graphVersion}/me?fields=id%2Cusername`, {
    headers: headers(account.ig_access_token),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const identity = await readResponse(response);
  if (typeof identity.id !== "string" || !identity.id ||
      typeof identity.username !== "string" ||
      identity.username.toLowerCase() !== account.ig_username.toLowerCase()) {
    throw new Error("Instagram /me identity does not match the stored username");
  }
  return identity.id as string;
}

export function createMetaGraphClient({ graphVersion, accessToken, instagramUserId, fetchImpl = fetch, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }: {
  graphVersion: string;
  accessToken: string;
  instagramUserId: string;
  fetchImpl?: Fetcher;
  requestTimeoutMs?: number;
}) {
  const base = `https://graph.instagram.com/${graphVersion}`;
  const get = async (path: string, fields: string) => {
    const response = await fetchImpl(`${base}/${path}?fields=${encodeURIComponent(fields)}`, {
      headers: headers(accessToken),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return readResponse(response);
  };
  const post = async (path: string, params: Record<string, string>) => {
    const response = await fetchImpl(`${base}/${path}`, {
      method: "POST",
      headers: { ...headers(accessToken), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return readResponse(response);
  };

  return {
    async createChild({ imageUrl }: { imageUrl?: string }) {
      if (!imageUrl) throw new Error("Carousel image URL is missing");
      return post(`${instagramUserId}/media`, { image_url: imageUrl, is_carousel_item: "true" });
    },
    async getContainerStatus(id: string) { return (await get(id, "status_code")).status_code; },
    async createParent({ children, caption }: { children: string[]; caption?: string }) {
      return post(`${instagramUserId}/media`, {
        media_type: "CAROUSEL", children: children.join(","), caption: caption ?? "",
      });
    },
    async publish(id: string) {
      const result = await post(`${instagramUserId}/media_publish`, { creation_id: id });
      return { ...result, timestamp: new Date().toISOString() };
    },
    async getPermalink(id: string) { return (await get(id, "permalink")).permalink; },
  };
}
