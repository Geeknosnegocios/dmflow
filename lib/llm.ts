/**
 * Unified LLM wrapper using Groq (free tier, OpenAI-compatible).
 * Model: llama-3.3-70b-versatile for quality, llama-3.1-8b-instant for speed.
 */
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmOpts = {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" } | { type: "text" };
};

export async function llmChat(
  messages: ChatMessage[],
  opts: LlmOpts = {}
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: opts.model ?? "llama-3.3-70b-versatile",
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.max_tokens ?? 512,
      messages,
      ...(opts.response_format ? { response_format: opts.response_format } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json: any = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export async function llmJson<T = any>(
  systemPrompt: string,
  userInput: string,
  opts: LlmOpts = {}
): Promise<T | null> {
  try {
    const out = await llmChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
      { ...opts, response_format: { type: "json_object" } }
    );
    return JSON.parse(out) as T;
  } catch (e) {
    console.warn("[llm] json parse failed:", (e as Error).message);
    return null;
  }
}
