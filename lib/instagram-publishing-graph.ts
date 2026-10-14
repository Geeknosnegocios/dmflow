const API = `https://graph.instagram.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;

type GraphResult = {
  id?: string;
  username?: string;
  status_code?: string;
  permalink?: string;
  error?: { code?: number; message?: string };
};

async function request(path: string, token: string, init: RequestInit): Promise<GraphResult> {
  const response = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    cache: "no-store",
  });
  const result = await response.json() as GraphResult;
  if (!response.ok || result.error) {
    throw new Error(`Instagram API HTTP ${response.status}, code ${result.error?.code ?? "unknown"}`);
  }
  return result;
}

export function graphGet(path: string, token: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params);
  return request(`${path}${query.size ? `?${query}` : ""}`, token, { method: "GET" });
}

export function graphPost(path: string, token: string, params: Record<string, string>) {
  return request(path, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function verifiedInstagramId(token: string, expectedUsername: string) {
  const identity = await graphGet("me", token, { fields: "id,username" });
  if (!identity.id || identity.username?.toLowerCase() !== expectedUsername.toLowerCase()) {
    throw new Error("Conta Instagram conectada não corresponde ao perfil esperado.");
  }
  return identity.id;
}
