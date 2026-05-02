import { llmJson } from "./llm";
import { supabaseAdmin } from "./supabase";

export type SentimentLabel = "positive" | "neutral" | "negative";

export type SentimentResult = {
  label: SentimentLabel;
  confidence: number;
  reason: string;
};

const SYSTEM_PROMPT = `Você é um classificador de sentimento em português do Brasil. Classifica comentários de Instagram em 3 categorias:
- "positive": elogio, interesse genuíno, entusiasmo, curiosidade positiva
- "neutral": pergunta informacional, comentário neutro, pedido normal, marcação de amigos
- "negative": reclamação, crítica agressiva, insulto, sarcasmo malicioso, spam ofensivo

Responda APENAS JSON válido no formato:
{"label": "positive"|"neutral"|"negative", "confidence": 0.0-1.0, "reason": "uma frase curta em pt-BR"}

Seja tolerante: brincadeiras, ironia leve ou gírias não são "negative". Só classifica como "negative" se for CLARAMENTE hostil ou reclamação séria.`;

export async function classifySentiment(
  text: string
): Promise<SentimentResult | null> {
  if (!text || text.trim().length < 2) {
    return { label: "neutral", confidence: 1, reason: "texto muito curto" };
  }
  const result = await llmJson<SentimentResult>(SYSTEM_PROMPT, text, {
    model: "llama-3.1-8b-instant",
    temperature: 0,
    max_tokens: 128,
  });
  if (!result?.label) return null;
  return result;
}

/**
 * Checks if comment should be blocked (negative sentiment above threshold).
 * Logs decision to dmflow.sentiment_log.
 */
export async function checkSentimentFilter(params: {
  accountId: string;
  minConfidence: number;
  commentText: string;
}): Promise<{ shouldBlock: boolean; result: SentimentResult | null }> {
  const sb = supabaseAdmin();
  const result = await classifySentiment(params.commentText).catch(() => null);

  if (!result) {
    return { shouldBlock: false, result: null };
  }

  const shouldBlock =
    result.label === "negative" && result.confidence >= params.minConfidence;

  await sb.from("sentiment_log").insert({
    account_id: params.accountId,
    comment_text: params.commentText.slice(0, 500),
    label: result.label,
    confidence: result.confidence,
    blocked: shouldBlock,
  });

  return { shouldBlock, result };
}
