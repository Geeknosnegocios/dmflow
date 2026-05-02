export const dynamic = "force-dynamic";

import { supabaseAdmin } from "@/lib/supabase";
import type { Account, Rule } from "@/types/db";
import { revalidatePath } from "next/cache";
import { Card, CardHeader, StatusPill, EmptyState } from "@/components/viz";
import { ConfirmForm } from "@/components/confirm-form";
import { MediaPicker } from "@/components/media-picker";
import { SubmitButton } from "@/components/submit-button";
import { TestRuleButton, DuplicateRuleButton } from "@/components/rule-actions";
import { DmPreview } from "@/components/dm-preview";
import { EditRuleButton } from "@/components/edit-rule-form";
import { RULE_TEMPLATES } from "@/lib/rule-templates";
import { fmtRelative } from "@/lib/format";
import { setFlash } from "@/lib/flash";
import {
  MessageSquare,
  Hand,
  Camera,
  Flame,
  Sparkles,
  Rocket,
  Tag,
  BookOpen,
  Calendar,
  Video,
} from "lucide-react";

const LUCIDE_MAP: Record<string, any> = {
  Rocket,
  Tag,
  BookOpen,
  Calendar,
  Video,
  Hand,
  Camera,
  MessageSquare,
};

async function createRule(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();
  const accountId = String(formData.get("account_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const triggerType = String(formData.get("trigger_type") ?? "comment") as any;
  const keyword = String(formData.get("keyword") ?? "").trim();
  const matchMode = String(formData.get("match_mode") ?? "contains") as any;
  const postId = String(formData.get("post_id") ?? "").trim() || null;
  const storyId = String(formData.get("story_id") ?? "").trim() || null;
  const publicReply = String(formData.get("public_reply") ?? "").trim() || null;
  const dmMessage = String(formData.get("dm_message") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 10);
  const followupDelay = Number(formData.get("followup_delay_hours") ?? 0);
  const followupMessage = String(formData.get("followup_message") ?? "").trim();

  const buttons: { url: string; title: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const url = String(formData.get(`btn_url_${i}`) ?? "").trim();
    const title = String(formData.get(`btn_text_${i}`) ?? "").trim();
    if (url && title) buttons.push({ url, title });
  }

  if (!accountId || !name || !dmMessage) {
    await setFlash({ kind: "error", message: "Preencha nome e mensagem da DM" });
    return;
  }

  const useKeyword = keyword.length > 0 && matchMode !== "any";

  const { error } = await sb.from("rules").insert({
    account_id: accountId,
    name,
    trigger_type: triggerType,
    keyword: useKeyword ? keyword : null,
    match_mode: useKeyword ? matchMode : "any",
    post_id: triggerType === "comment" ? postId : null,
    story_id: triggerType === "story_reply" ? storyId : null,
    public_reply: triggerType === "comment" ? publicReply : null,
    dm_message: dmMessage,
    dm_buttons: buttons.length > 0 ? buttons : null,
    priority,
    followup_delay_hours: followupDelay > 0 ? followupDelay : null,
    followup_message: followupMessage || null,
  });

  if (error) {
    await setFlash({ kind: "error", message: `Falha: ${error.message}` });
  } else {
    await setFlash({ kind: "success", message: `Regra "${name}" criada` });
  }

  revalidatePath("/dashboard/rules");
}

async function toggleRule(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();
  const id = String(formData.get("id"));
  const active = formData.get("active") === "true";
  await sb.from("rules").update({ active: !active }).eq("id", id);
  await setFlash({
    kind: "info",
    message: active ? "Regra pausada" : "Regra ativada",
  });
  revalidatePath("/dashboard/rules");
}

async function deleteRule(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();
  const id = String(formData.get("id"));
  const { error } = await sb.from("rules").delete().eq("id", id);
  if (error) {
    await setFlash({ kind: "error", message: `Falha ao excluir: ${error.message}` });
  } else {
    await setFlash({ kind: "warn", message: "Regra excluída" });
  }
  revalidatePath("/dashboard/rules");
}

async function updateRule(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const triggerType = String(formData.get("trigger_type") ?? "comment") as any;
  const keyword = String(formData.get("keyword") ?? "").trim();
  const matchMode = String(formData.get("match_mode") ?? "contains") as any;
  const publicReply = String(formData.get("public_reply") ?? "").trim() || null;
  const dmMessage = String(formData.get("dm_message") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 10);
  const followupDelay = Number(formData.get("followup_delay_hours") ?? 0);
  const followupMessage = String(formData.get("followup_message") ?? "").trim();

  const buttons: { url: string; title: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const url = String(formData.get(`btn_url_${i}`) ?? "").trim();
    const title = String(formData.get(`btn_text_${i}`) ?? "").trim();
    if (url && title) buttons.push({ url, title });
  }

  if (!id || !name || !dmMessage) {
    await setFlash({ kind: "error", message: "Preencha nome e mensagem da DM" });
    return;
  }

  const useKeyword = keyword.length > 0 && matchMode !== "any";

  const { error } = await sb.from("rules").update({
    name,
    trigger_type: triggerType,
    keyword: useKeyword ? keyword : null,
    match_mode: useKeyword ? matchMode : "any",
    public_reply: triggerType === "comment" ? publicReply : null,
    dm_message: dmMessage,
    dm_buttons: buttons.length > 0 ? buttons : null,
    priority,
    followup_delay_hours: followupDelay > 0 ? followupDelay : null,
    followup_message: followupMessage || null,
  }).eq("id", id);

  if (error) {
    await setFlash({ kind: "error", message: `Falha ao salvar: ${error.message}` });
  } else {
    await setFlash({ kind: "success", message: `Regra "${name}" atualizada` });
  }

  revalidatePath("/dashboard/rules");
}

async function bulkAction(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();
  const ids = formData.getAll("bulk_id").map(String);
  const action = String(formData.get("bulk_action") ?? "");
  if (ids.length === 0 || !action) return;

  if (action === "pause") {
    await sb.from("rules").update({ active: false }).in("id", ids);
    await setFlash({ kind: "info", message: `${ids.length} regra(s) pausadas` });
  } else if (action === "activate") {
    await sb.from("rules").update({ active: true }).in("id", ids);
    await setFlash({ kind: "success", message: `${ids.length} regra(s) ativadas` });
  } else if (action === "delete") {
    await sb.from("rules").delete().in("id", ids);
    await setFlash({ kind: "warn", message: `${ids.length} regra(s) excluídas` });
  }
  revalidatePath("/dashboard/rules");
}

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const params = await searchParams;
  const templateId = params.template;
  const selectedTemplate = templateId
    ? RULE_TEMPLATES.find((t) => t.id === templateId) ?? null
    : null;

  const sb = supabaseAdmin();
  const { data: accounts } = await sb
    .from("accounts")
    .select("id, name, ig_username")
    .eq("active", true);
  const { data: rules } = await sb
    .from("rules")
    .select("*")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  const accountList = (accounts ?? []) as Pick<Account, "id" | "name" | "ig_username">[];
  const firstAccountId = accountList[0]?.id ?? "";
  const ruleList = (rules ?? []) as Rule[];

  // Prefill from template
  const prefill = selectedTemplate
    ? {
        name: selectedTemplate.name,
        trigger_type: selectedTemplate.trigger_type,
        keyword: selectedTemplate.keyword ?? "",
        match_mode: selectedTemplate.match_mode,
        public_reply: selectedTemplate.public_reply ?? "",
        dm_message: selectedTemplate.dm_message,
        buttons: selectedTemplate.dm_buttons,
        followup_delay_hours: selectedTemplate.followup_delay_hours ?? 0,
        followup_message: selectedTemplate.followup_message ?? "",
      }
    : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Regras</h1>
          <p className="text-dim-2 text-sm">
            {ruleList.length} regra{ruleList.length !== 1 && "s"} configurada
            {ruleList.length !== 1 && "s"}
          </p>
        </div>
        <a
          href="#new"
          className="inline-flex items-center gap-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-4 py-2 text-sm transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          Nova regra
        </a>
      </header>

      {/* Templates gallery */}
      <Card>
        <CardHeader
          title="Templates prontos"
          subtitle="Clica num template pra pré-preencher o form abaixo"
        />
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {RULE_TEMPLATES.map((t) => {
            const Icon = LUCIDE_MAP[t.icon] ?? Sparkles;
            return (
              <a
                key={t.id}
                href={`?template=${t.id}#new`}
                className="flex items-start gap-3 p-3 rounded-lg border border-line hover:border-accent/40 bg-bg-1 hover:bg-surface-2 transition-colors group"
              >
                <div className="h-9 w-9 rounded-lg bg-accent-dim flex items-center justify-center text-accent flex-shrink-0 group-hover:scale-105 transition-transform">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="text-tiny text-dim-2 line-clamp-2 mt-0.5">
                    {t.description}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </Card>

      {/* Rules grid with bulk actions */}
      {ruleList.length > 0 ? (
        <>
          {/* Hidden bulk form — checkboxes and buttons reference it via form="bulk-form" */}
          <form id="bulk-form" action={bulkAction} className="hidden" />
          <div className="flex items-center justify-between mb-3 text-tiny text-dim-2 gap-3 flex-wrap">
            <span>Selecione regras pra ação em lote:</span>
            <div className="flex gap-2">
              <button
                type="submit"
                form="bulk-form"
                name="bulk_action"
                value="activate"
                className="rounded-md border border-line-2 px-2.5 py-1 hover:border-good/40 hover:text-good transition-colors min-h-[32px]"
              >
                Ativar selecionadas
              </button>
              <button
                type="submit"
                form="bulk-form"
                name="bulk_action"
                value="pause"
                className="rounded-md border border-line-2 px-2.5 py-1 hover:border-warn/40 hover:text-warn transition-colors min-h-[32px]"
              >
                Pausar selecionadas
              </button>
              <button
                type="submit"
                form="bulk-form"
                name="bulk_action"
                value="delete"
                className="rounded-md border border-line-2 px-2.5 py-1 hover:border-danger/40 hover:text-danger transition-colors min-h-[32px]"
              >
                Excluir selecionadas
              </button>
            </div>
          </div>
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ruleList.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                toggleAction={toggleRule}
                deleteAction={deleteRule}
                updateAction={updateRule}
              />
            ))}
          </section>
        </>
      ) : (
        <EmptyState
          title="Sem regras ainda"
          message="Escolha um template acima ou crie do zero no form abaixo."
        />
      )}

      {/* New rule form */}
      <section id="new">
        <Card>
          <CardHeader
            title={selectedTemplate ? `Nova regra · baseada em "${selectedTemplate.name}"` : "Nova regra"}
            subtitle={
              selectedTemplate
                ? "Edite os campos antes de salvar"
                : "Configura o gatilho e o que acontece"
            }
            right={
              selectedTemplate && (
                <a
                  href="/dashboard/rules#new"
                  className="text-tiny text-dim-2 hover:text-fg"
                >
                  Limpar template
                </a>
              )
            }
          />
          <form action={createRule} className="p-5 space-y-5">
            <FormGroup step="01" title="Quando deve disparar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select name="account_id" defaultValue={firstAccountId} required>
                  {accountList.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                <Select
                  name="trigger_type"
                  defaultValue={prefill?.trigger_type ?? "comment"}
                >
                  <option value="comment">Comentário em post</option>
                  <option value="first_dm">Primeira DM (boas-vindas)</option>
                  <option value="story_reply">Resposta a story</option>
                </Select>
              </div>
            </FormGroup>

            <FormGroup step="02" title="Como combinar">
              <Input
                name="name"
                placeholder="Nome da regra (interno)"
                defaultValue={prefill?.name ?? ""}
                required
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  name="keyword"
                  placeholder='Keyword (ex: "QUERO") — vazio = qualquer texto'
                  defaultValue={prefill?.keyword ?? ""}
                />
                <Select
                  name="match_mode"
                  defaultValue={prefill?.match_mode ?? "contains"}
                >
                  <option value="contains">contém keyword</option>
                  <option value="exact">exato</option>
                  <option value="starts_with">começa com</option>
                  <option value="any">qualquer texto dispara</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-tiny text-dim-2 uppercase tracking-wider block">
                  Post (só pra comentário)
                </label>
                <MediaPicker
                  name="post_id"
                  accountId={firstAccountId}
                  placeholder="Clique pra escolher post · vazio = todos"
                />
                <Input
                  name="story_id"
                  placeholder="Story ID (só pra story_reply · prefira /stories)"
                />
              </div>
            </FormGroup>

            <FormGroup step="03" title="O que responder">
              <Textarea
                name="public_reply"
                placeholder="Resposta pública no comentário (só vale pra trigger comment)"
                rows={2}
                defaultValue={prefill?.public_reply ?? ""}
              />
              <Textarea
                name="dm_message"
                placeholder="Mensagem DM *  —  use {first_name}, {username}, {hour_greeting}"
                rows={3}
                defaultValue={prefill?.dm_message ?? ""}
                required
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-tiny text-dim-2 uppercase tracking-wider">
                    Botões (até 3)
                  </div>
                  <div className="text-tiny text-dim-2">
                    Placeholders disponíveis: <code>{"{first_name}"}</code>,{" "}
                    <code>{"{username}"}</code>, <code>{"{hour_greeting}"}</code>
                  </div>
                </div>
                {[0, 1, 2].map((i) => {
                  const pre = prefill?.buttons?.[i];
                  return (
                    <div key={i} className="grid grid-cols-[1fr_2fr] gap-2">
                      <Input
                        name={`btn_text_${i}`}
                        placeholder={`Botão ${i + 1} · texto`}
                        maxLength={20}
                        defaultValue={pre?.title ?? ""}
                      />
                      <Input
                        name={`btn_url_${i}`}
                        placeholder={`Botão ${i + 1} · URL`}
                        defaultValue={pre?.url ?? ""}
                      />
                    </div>
                  );
                })}
              </div>
            </FormGroup>

            <FormGroup step="04" title="Follow-up automático (opcional)">
              <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-3">
                <Input
                  name="followup_delay_hours"
                  type="number"
                  min={0}
                  placeholder="48"
                  defaultValue={prefill?.followup_delay_hours ?? 0}
                />
                <Textarea
                  name="followup_message"
                  rows={2}
                  placeholder="Mensagem 2ª DM se user não clicou (deixe vazio pra desligar)"
                  defaultValue={prefill?.followup_message ?? ""}
                />
              </div>
              <p className="text-tiny text-dim-2">
                Horas depois do primeiro contato. Só dispara se user não clicou.
              </p>
            </FormGroup>

            <div className="flex items-center justify-between pt-3 border-t border-line">
              <Input
                name="priority"
                type="number"
                defaultValue={10}
                placeholder="Prioridade"
                className="max-w-[160px]"
              />
              <SubmitButton
                pendingLabel="Criando…"
                className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-5 py-2.5 text-sm transition-colors"
              >
                Criar regra
              </SubmitButton>
            </div>
          </form>
        </Card>
      </section>

      {/* Live preview */}
      {prefill && (
        <Card>
          <CardHeader
            title="Preview no Instagram"
            subtitle="Mockup de como a DM vai aparecer"
          />
          <div className="p-5 max-w-md">
            <DmPreview
              message={prefill.dm_message}
              buttons={prefill.buttons}
              brandName={accountList[0]?.ig_username ?? "andreyweslley"}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

/* =========== Sub components =========== */

function RuleCard({
  rule,
  toggleAction,
  deleteAction,
  updateAction,
}: {
  rule: Rule;
  toggleAction: (fd: FormData) => void;
  deleteAction: (fd: FormData) => void;
  updateAction: (fd: FormData) => Promise<void>;
}) {
  const triggerMap: Record<string, { label: string; tone: any; Icon: any }> = {
    comment: { label: "comentário", tone: "accent", Icon: MessageSquare },
    first_dm: { label: "1ª DM", tone: "violet", Icon: Hand },
    story_reply: { label: "story", tone: "warn", Icon: Camera },
  };
  const t = triggerMap[rule.trigger_type] ?? triggerMap.comment;
  const { Icon } = t;

  return (
    <div
      className={`rounded-xl border ${
        rule.active ? "border-line-2" : "border-line opacity-70"
      } bg-surface shadow-card p-5 flex flex-col gap-3`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <label className="flex items-center h-10">
            <input
              type="checkbox"
              name="bulk_id"
              value={rule.id}
              form="bulk-form"
              className="h-4 w-4 rounded border-line-2 bg-bg-1 accent-accent cursor-pointer"
            />
          </label>
          <div className="h-10 w-10 rounded-lg bg-bg-2 border border-line-2 flex items-center justify-center flex-shrink-0 text-accent">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-fg truncate">{rule.name}</span>
              <StatusPill tone={t.tone} label={t.label} />
              {!rule.active && <StatusPill tone="dim" label="pausada" />}
              {rule.followup_delay_hours && rule.followup_message && (
                <StatusPill tone="violet" label={`+follow-up ${rule.followup_delay_hours}h`} />
              )}
            </div>
            {rule.keyword && (
              <div className="mt-1 text-tiny font-mono text-dim-2">
                {rule.match_mode} · "{rule.keyword}"
              </div>
            )}
          </div>
        </div>
      </div>

      {rule.public_reply && (
        <div className="text-sm text-dim-2 bg-bg-1 rounded-lg border border-line px-3 py-2">
          <span className="text-tiny font-mono text-accent uppercase">reply:</span>{" "}
          {rule.public_reply}
        </div>
      )}

      <div className="text-sm text-fg bg-bg-1 rounded-lg border border-line px-3 py-2">
        <span className="text-tiny font-mono text-accent uppercase">dm:</span>{" "}
        {rule.dm_message}
      </div>

      {Array.isArray(rule.dm_buttons) && rule.dm_buttons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rule.dm_buttons.map((b, idx) => (
            <span
              key={idx}
              className="text-tiny font-medium rounded-md border border-accent/30 bg-accent-dim text-accent px-2 py-1 max-w-full truncate"
              title={b.url}
            >
              {b.title}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-line gap-2 flex-wrap">
        <div className="flex items-center gap-3 text-tiny text-dim-2">
          <span className="mono-num inline-flex items-center gap-1">
            <Flame className="h-3 w-3" />
            {rule.triggered_count}x
          </span>
          <span>prio {rule.priority}</span>
          <span className="font-mono">{fmtRelative(rule.created_at)}</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          <TestRuleButton ruleId={rule.id} />
          <DuplicateRuleButton ruleId={rule.id} />
          <EditRuleButton rule={rule} updateAction={updateAction} />
          <form action={toggleAction}>
            <input type="hidden" name="id" value={rule.id} />
            <input type="hidden" name="active" value={String(rule.active)} />
            <button
              type="submit"
              className="text-tiny rounded-md border min-h-[32px] inline-flex items-center justify-center border-line-2 hover:border-accent/40 px-2.5 py-1 text-dim-2 hover:text-accent transition-colors"
            >
              {rule.active ? "pausar" : "ativar"}
            </button>
          </form>
          <ConfirmForm
            action={deleteAction}
            label="excluir"
            confirmLabel="confirmar?"
            hiddenFields={{ id: rule.id }}
          />
        </div>
      </div>
    </div>
  );
}

function FormGroup({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-tiny font-mono text-accent bg-accent-dim rounded px-1.5 py-0.5">
          {step}
        </span>
        <span className="text-sm font-medium text-dim-2">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Input({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors ${className}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 transition-colors resize-y"
    />
  );
}

function Select({ children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/50 transition-colors"
    >
      {children}
    </select>
  );
}
