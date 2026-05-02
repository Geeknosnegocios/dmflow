import { supabaseAdmin } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { Card, CardHeader, EmptyState, StatusPill } from "@/components/viz";
import type { Account } from "@/types/db";

export const dynamic = "force-dynamic";

type Story = {
  id: string;
  media_type: string;
  media_url: string;
  thumbnail_url: string;
  timestamp: string;
  permalink: string;
  caption: string | null;
};

async function fetchStories(accountId: string): Promise<Story[]> {
  const sb = supabaseAdmin();
  const { data: account } = await sb
    .from("accounts")
    .select("ig_access_token")
    .eq("id", accountId)
    .maybeSingle<Account>();
  if (!account) return [];

  const url =
    "https://graph.instagram.com/v25.0/me/stories?fields=id,media_type,media_url,thumbnail_url,timestamp,permalink,caption";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${account.ig_access_token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json: any = await res.json().catch(() => ({}));
  return (json.data ?? []) as Story[];
}

async function createStoryRule(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();

  const accountId = String(formData.get("account_id"));
  const storyId = String(formData.get("story_id"));
  const storyLabel = String(formData.get("story_label") ?? "");
  const keyword = String(formData.get("keyword") ?? "").trim();
  const matchMode = (String(formData.get("match_mode") ?? "contains")) as any;
  const dmMessage = String(formData.get("dm_message") ?? "").trim();
  const buttonText = String(formData.get("button_text") ?? "").trim();
  const buttonUrl = String(formData.get("button_url") ?? "").trim();

  if (!accountId || !storyId || !dmMessage) return;

  const useKeyword = keyword.length > 0 && matchMode !== "any";

  await sb.from("rules").insert({
    account_id: accountId,
    name: `Story ${storyLabel} — ${keyword || "qualquer resposta"}`,
    trigger_type: "story_reply",
    story_id: storyId,
    keyword: useKeyword ? keyword : null,
    match_mode: useKeyword ? matchMode : "any",
    dm_message: dmMessage,
    dm_buttons:
      buttonText && buttonUrl
        ? [{ title: buttonText, url: buttonUrl }]
        : null,
    priority: 30,
  });

  revalidatePath("/dashboard/stories");
}

export default async function StoriesPage() {
  const sb = supabaseAdmin();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name, ig_username")
    .eq("active", true);

  const account = accounts?.[0];
  if (!account) {
    return (
      <EmptyState
        title="Nenhuma conta conectada"
        message="Cadastre uma conta Instagram antes de usar stories."
      />
    );
  }

  const stories = await fetchStories(account.id);

  const { data: existingRules } = await sb
    .from("rules")
    .select("id, name, keyword, story_id, triggered_count, active")
    .eq("account_id", account.id)
    .eq("trigger_type", "story_reply")
    .order("created_at", { ascending: false });

  const rulesByStory = new Map<string, any[]>();
  for (const r of (existingRules ?? []) as any[]) {
    if (!r.story_id) continue;
    const arr = rulesByStory.get(r.story_id) ?? [];
    arr.push(r);
    rulesByStory.set(r.story_id, arr);
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Stories ativos</h1>
          <p className="text-dim-2 text-sm">
            @{account.ig_username} · últimos 24h · clica num story pra criar regra
          </p>
        </div>
        <StatusPill
          tone={stories.length > 0 ? "accent" : "dim"}
          label={`${stories.length} ativo${stories.length !== 1 ? "s" : ""}`}
        />
      </header>

      {stories.length === 0 ? (
        <EmptyState
          title="Sem stories ativos no momento"
          message="Stories expiram em 24h. Publica um no Instagram e volta aqui — vai aparecer em segundos."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stories.map((s) => {
            const rules = rulesByStory.get(s.id) ?? [];
            const storyLabel = new Date(s.timestamp).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <Card key={s.id} className="overflow-hidden">
                <div className="aspect-[9/16] bg-bg-1 relative">
                  {s.media_type === "VIDEO" ? (
                    <video
                      src={s.media_url}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.thumbnail_url || s.media_url}
                      alt="story"
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute top-3 left-3">
                    <StatusPill
                      tone={s.media_type === "VIDEO" ? "violet" : "accent"}
                      label={s.media_type}
                    />
                  </div>
                  {rules.length > 0 && (
                    <div className="absolute top-3 right-3">
                      <StatusPill
                        tone="good"
                        label={`${rules.length} regra${rules.length !== 1 ? "s" : ""}`}
                        pulse
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between text-tiny text-dim-2 font-mono">
                    <span>{storyLabel}</span>
                    <span className="truncate max-w-[60%]" title={s.id}>
                      {s.id.slice(0, 14)}…
                    </span>
                  </div>

                  {rules.length > 0 && (
                    <div className="space-y-1">
                      {rules.map((r) => (
                        <div
                          key={r.id}
                          className="text-tiny flex justify-between items-center bg-accent-dim rounded px-2 py-1"
                        >
                          <span className="text-accent font-mono">
                            {r.keyword ?? "qualquer"}
                          </span>
                          <span className="text-dim-2 mono-num">
                            {r.triggered_count}x
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-accent hover:text-accent/80 list-none select-none">
                      + Nova regra pra este story
                    </summary>
                    <form
                      action={createStoryRule}
                      className="mt-3 space-y-2"
                    >
                      <input type="hidden" name="account_id" value={account.id} />
                      <input type="hidden" name="story_id" value={s.id} />
                      <input type="hidden" name="story_label" value={storyLabel} />
                      <input
                        name="keyword"
                        placeholder='Keyword (ex: "TURBO") ou vazio'
                        className="w-full bg-bg-1 border border-line-2 rounded-lg px-2.5 py-1.5 text-xs"
                      />
                      <select
                        name="match_mode"
                        defaultValue="contains"
                        className="w-full bg-bg-1 border border-line-2 rounded-lg px-2.5 py-1.5 text-xs"
                      >
                        <option value="contains">contém keyword</option>
                        <option value="exact">exato</option>
                        <option value="starts_with">começa com</option>
                        <option value="any">qualquer resposta</option>
                      </select>
                      <textarea
                        name="dm_message"
                        rows={2}
                        defaultValue="Valeu por responder meu story 🔥 Como prometi, aqui está o material 👇"
                        className="w-full bg-bg-1 border border-line-2 rounded-lg px-2.5 py-1.5 text-xs"
                        required
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          name="button_text"
                          placeholder="Botão"
                          defaultValue="Acessar"
                          maxLength={20}
                          className="bg-bg-1 border border-line-2 rounded-lg px-2.5 py-1.5 text-xs"
                        />
                        <input
                          name="button_url"
                          placeholder="URL"
                          defaultValue="https://geek-os.geekacademy.site/?utm_source=instagram&utm_medium=dmflow&utm_campaign=story"
                          className="bg-bg-1 border border-line-2 rounded-lg px-2.5 py-1.5 text-xs"
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold py-2 text-xs transition-colors"
                      >
                        Criar regra
                      </button>
                    </form>
                  </details>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
