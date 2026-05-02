import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { llmJson } from "@/lib/llm";
import type { Account } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Suggestion = {
  keyword: string;
  rationale: string;
  suggested_cta: string;
};

const SYSTEM_PROMPT = `Você é um estrategista de automação de DMs de Instagram. O objetivo é identificar palavras-chave de CTA que performam bem em posts pra disparar automações (ex: "Comenta QUERO que te mando o link").

Dada uma amostra de comentários e as palavras-chave JÁ em uso, sugira 5 novas palavras de CTA que:
1. Sejam curtas (1 palavra, max 8 chars)
2. Maiúsculas, memoráveis
3. Tenham ganchos emocionais ou de curiosidade (ex: SISTEMA, ACESSO, MANDA, LISTA, SEGREDO, PROVA, FREE, AULA)
4. Sejam diferentes das já em uso
5. Se encaixem no nicho sugerido pelos comentários existentes

Responda JSON:
{
  "suggestions": [
    {"keyword": "SISTEMA", "rationale": "evoca método/processo", "suggested_cta": "Comenta SISTEMA pra receber o passo-a-passo"},
    ...
  ]
}`;

export async function GET(_req: NextRequest) {
  const sb = supabaseAdmin();

  const { data: account } = await sb
    .from("accounts")
    .select("*")
    .eq("active", true)
    .limit(1)
    .maybeSingle<Account>();
  if (!account) {
    return NextResponse.json({ error: "no account" }, { status: 404 });
  }

  const [eventsRes, rulesRes] = await Promise.all([
    sb
      .from("events")
      .select("comment_text")
      .eq("account_id", account.id)
      .not("comment_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
    sb
      .from("rules")
      .select("keyword")
      .eq("account_id", account.id)
      .not("keyword", "is", null),
  ]);

  const comments = (eventsRes.data ?? [])
    .map((e: any) => e.comment_text)
    .filter(Boolean)
    .slice(0, 100);
  const currentKeywords = (rulesRes.data ?? [])
    .map((r: any) => r.keyword)
    .filter(Boolean);

  if (comments.length === 0) {
    return NextResponse.json({
      suggestions: [],
      note: "Sem comentários suficientes ainda. Rode um post com CTA primeiro.",
    });
  }

  const userInput = `Comentários recentes (até 100):
${comments.map((c: string) => `- ${c.slice(0, 120)}`).join("\n")}

Palavras-chave já em uso: ${currentKeywords.join(", ") || "(nenhuma)"}

Sugira 5 novas keywords de CTA.`;

  const result = await llmJson<{ suggestions: Suggestion[] }>(
    SYSTEM_PROMPT,
    userInput,
    { temperature: 0.7, max_tokens: 800 }
  );

  if (!result?.suggestions) {
    return NextResponse.json(
      { error: "LLM failed to generate suggestions" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    suggestions: result.suggestions.slice(0, 5),
    comments_analyzed: comments.length,
    keywords_in_use: currentKeywords,
  });
}
