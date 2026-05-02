import { supabaseAdmin } from "@/lib/supabase";
import { Card, CardHeader, StatusPill } from "@/components/viz";
import { ConfirmForm } from "@/components/confirm-form";
import { SubmitButton } from "@/components/submit-button";
import { setFlash } from "@/lib/flash";
import type { Account } from "@/types/db";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function updateAccount(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const notifyEmail = String(formData.get("notify_email") ?? "").trim() || null;
  const active = formData.get("active") === "on";
  const webhookUrl = String(formData.get("outgoing_webhook_url") ?? "").trim() || null;
  const webhookSecret = String(formData.get("outgoing_webhook_secret") ?? "").trim() || null;
  const sentimentFilter = formData.get("sentiment_filter_enabled") === "on";
  const sentimentMin = Number(formData.get("sentiment_min_confidence") ?? 0.7);

  const { error } = await sb
    .from("accounts")
    .update({
      name,
      notify_email: notifyEmail,
      active,
      outgoing_webhook_url: webhookUrl,
      outgoing_webhook_secret: webhookSecret,
      sentiment_filter_enabled: sentimentFilter,
      sentiment_min_confidence: sentimentMin,
    })
    .eq("id", id);

  if (error) {
    await setFlash({ kind: "error", message: `Falha: ${error.message}` });
  } else {
    await setFlash({ kind: "success", message: "Configurações salvas" });
  }

  revalidatePath("/dashboard/settings");
}

async function rotateVerifyToken(formData: FormData) {
  "use server";
  const sb = supabaseAdmin();
  const id = String(formData.get("id"));
  const newToken = `dmflow_verify_${Math.random().toString(36).slice(2, 18)}`;
  await sb.from("accounts").update({ verify_token: newToken }).eq("id", id);
  await setFlash({
    kind: "warn",
    message: "Token rotacionado. Atualiza no Meta dashboard agora!",
  });
  revalidatePath("/dashboard/settings");
}

export default async function SettingsPage() {
  const sb = supabaseAdmin();
  const { data: account } = await sb
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<Account>();

  if (!account) {
    return (
      <div className="space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Settings</h1>
        <div className="text-dim-2 text-sm">
          Nenhuma conta cadastrada ainda.
        </div>
      </div>
    );
  }

  const tokenDays = account.ig_token_expires_at
    ? Math.round(
        (new Date(account.ig_token_expires_at).getTime() - Date.now()) /
          86400000
      )
    : null;
  const tokenTone: any =
    tokenDays === null
      ? "dim"
      : tokenDays < 7
      ? "danger"
      : tokenDays < 14
      ? "warn"
      : "good";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Settings</h1>
        <p className="text-dim-2 text-sm">
          Conta · notificações · integrações
        </p>
      </header>

      {/* Account card */}
      <Card>
        <CardHeader
          title="Conta Instagram"
          subtitle={`@${account.ig_username ?? "—"}`}
          right={
            <StatusPill
              tone={tokenTone}
              label={
                tokenDays === null
                  ? "token ok"
                  : `${tokenDays}d restantes`
              }
              pulse={tokenTone === "good"}
            />
          }
        />
        <form action={updateAccount} className="p-5 space-y-4">
          <input type="hidden" name="id" value={account.id} />

          <Field
            label="Nome interno"
            hint="Como aparece no dashboard"
          >
            <Input
              name="name"
              defaultValue={account.name}
              placeholder="ex: Andrey Weslley — Principal"
            />
          </Field>

          <Field
            label="Email de alertas"
            hint="Recebe aviso quando token expira ou DM falha"
          >
            <Input
              name="notify_email"
              type="email"
              defaultValue={account.notify_email ?? ""}
              placeholder="voce@email.com"
            />
          </Field>

          <div className="flex items-center justify-between py-2 border-t border-line">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="active"
                defaultChecked={account.active}
                className="h-4 w-4 rounded border-line-2 bg-bg-1 accent-accent"
              />
              <span>Regras ativas</span>
              <span className="text-tiny text-dim-2">
                · desativar pausa todas as automações
              </span>
            </label>
            <SubmitButton
              pendingLabel="Salvando…"
              className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-4 py-2 text-sm transition-colors"
            >
              Salvar
            </SubmitButton>
          </div>
        </form>
      </Card>

      {/* Technical details */}
      <Card>
        <CardHeader
          title="Detalhes técnicos"
          subtitle="Read-only · salve em local seguro"
        />
        <div className="p-5 space-y-3">
          <Readonly label="Account ID" value={account.id} />
          <Readonly label="IG Business ID" value={account.ig_business_id} />
          <Readonly label="App ID" value={account.app_id ?? "—"} />
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Readonly label="Verify token" value={account.verify_token} />
            </div>
            <ConfirmForm
              action={rotateVerifyToken}
              label="rotacionar"
              confirmLabel="quebra webhook!"
              tone="warn"
              hiddenFields={{ id: account.id }}
            />
          </div>
          {account.ig_token_refreshed_at && (
            <Readonly
              label="Último refresh token"
              value={new Date(account.ig_token_refreshed_at).toLocaleString(
                "pt-BR"
              )}
            />
          )}
          {account.ig_token_expires_at && (
            <Readonly
              label="Token expira em"
              value={new Date(account.ig_token_expires_at).toLocaleString(
                "pt-BR"
              )}
            />
          )}
        </div>
      </Card>

      {/* Webhook info */}
      <Card>
        <CardHeader
          title="Webhook Meta"
          subtitle="Configurar em Meta for Developers"
        />
        <div className="p-5 space-y-3">
          <Readonly
            label="Callback URL"
            value="https://dmflow.vercel.app/api/webhook/instagram"
          />
          <Readonly label="Verify token" value={account.verify_token} />
          <div className="text-tiny text-dim-2 leading-relaxed">
            Em{" "}
            <a
              href={`https://developers.facebook.com/apps/${account.app_id ?? ""}/instagram-business/API-Setup/`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent hover:underline"
            >
              Meta App Dashboard
            </a>
            : Instagram → Configuração da API com login do Instagram → Configure
            webhooks. Assinar campos <code>comments</code>, <code>messages</code>.
          </div>
        </div>
      </Card>

      {/* Sentiment filter (AI) */}
      <Card>
        <CardHeader
          title="Filtro de sentimento IA"
          subtitle="Bloqueia disparo automático em comentários negativos (Groq Llama 3.3)"
          right={
            account.sentiment_filter_enabled ? (
              <StatusPill tone="good" label="ativo" />
            ) : (
              <StatusPill tone="dim" label="desligado" />
            )
          }
        />
        <form action={updateAccount} className="p-5 space-y-4">
          <input type="hidden" name="id" value={account.id} />
          <input type="hidden" name="name" value={account.name} />
          <input type="hidden" name="notify_email" value={account.notify_email ?? ""} />
          <input type="hidden" name="active" value={account.active ? "on" : ""} />
          <input
            type="hidden"
            name="outgoing_webhook_url"
            value={account.outgoing_webhook_url ?? ""}
          />
          <input
            type="hidden"
            name="outgoing_webhook_secret"
            value={account.outgoing_webhook_secret ?? ""}
          />

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              name="sentiment_filter_enabled"
              defaultChecked={account.sentiment_filter_enabled}
              className="h-4 w-4 rounded border-line-2 bg-bg-1 accent-accent"
            />
            <span>Bloquear disparos em comentários negativos</span>
          </label>

          <Field
            label="Confiança mínima"
            hint="0.5 a 1.0 · só bloqueia se IA tiver certeza dessa ordem"
          >
            <Input
              name="sentiment_min_confidence"
              type="number"
              step="0.05"
              min="0.5"
              max="1"
              defaultValue={account.sentiment_min_confidence}
            />
          </Field>

          <div className="bg-bg-1 rounded-lg border border-line p-3 text-tiny text-dim-2">
            Classifica cada comentário em <code>positive</code>, <code>neutral</code> ou{" "}
            <code>negative</code>. Se classificar como negative com confiança ≥ threshold,
            não dispara DM/reply. Decisão logada em <code>dmflow.sentiment_log</code>.
          </div>

          <div className="flex justify-end">
            <SubmitButton
              pendingLabel="Salvando…"
              className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-4 py-2 text-sm transition-colors"
            >
              Salvar filtro
            </SubmitButton>
          </div>
        </form>
      </Card>

      {/* Outgoing webhook */}
      <Card>
        <CardHeader
          title="Webhook outgoing"
          subtitle="Dispara POST pra URL externa em cada evento — Zapier, n8n, Make, Brevo, Slack"
          right={
            account.outgoing_webhook_url ? (
              <StatusPill tone="good" label="configurado" />
            ) : (
              <StatusPill tone="dim" label="desligado" />
            )
          }
        />
        <form action={updateAccount} className="p-5 space-y-4">
          <input type="hidden" name="id" value={account.id} />
          <input type="hidden" name="name" value={account.name} />
          <input type="hidden" name="notify_email" value={account.notify_email ?? ""} />
          <input
            type="hidden"
            name="active"
            value={account.active ? "on" : ""}
          />

          <Field
            label="URL do webhook"
            hint="POST c/ JSON · header x-dmflow-signature-256 se secret setado"
          >
            <Input
              name="outgoing_webhook_url"
              type="url"
              defaultValue={account.outgoing_webhook_url ?? ""}
              placeholder="https://hook.zapier.com/..."
            />
          </Field>

          <Field
            label="Secret (HMAC)"
            hint="Opcional · valida autenticidade do payload"
          >
            <Input
              name="outgoing_webhook_secret"
              defaultValue={account.outgoing_webhook_secret ?? ""}
              placeholder="Qualquer string — ex: dmflow_hook_secret_123"
            />
          </Field>

          <div className="bg-bg-1 rounded-lg border border-line p-3 text-tiny text-dim-2 space-y-1 font-mono">
            <div>POST {account.outgoing_webhook_url || "<sua URL>"}</div>
            <div>x-dmflow-event: event.created</div>
            <div>x-dmflow-signature-256: sha256=...</div>
            <div>{`{ "event": "event.created", "data": { "ig_username": "...", "matched_keyword": "...", "dm_sent": true, ... } }`}</div>
          </div>

          <div className="flex justify-end">
            <SubmitButton
              pendingLabel="Salvando…"
              className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-4 py-2 text-sm transition-colors"
            >
              Salvar webhook
            </SubmitButton>
          </div>
        </form>
      </Card>

      {/* Integrations */}
      <Card>
        <CardHeader
          title="Integrações"
          subtitle="Serviços conectados"
        />
        <div className="divide-y divide-line">
          <IntegrationRow
            name="Supabase"
            description="Database · schema dmflow"
            connected
          />
          <IntegrationRow
            name="Vercel"
            description="Hospedagem + cron jobs"
            connected
          />
          <IntegrationRow
            name="Brevo"
            description="Email transacional · alertas"
            connected
          />
          <IntegrationRow
            name="Meta Instagram Graph"
            description="Webhook + API"
            connected
          />
          <IntegrationRow
            name="Stripe"
            description="Cobrança (em breve)"
            connected={false}
          />
          <IntegrationRow
            name="Brevo Lists (sync leads)"
            description="Sincronizar novos leads (em breve)"
            connected={false}
          />
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="border-danger/30">
        <CardHeader title="Zona perigosa" subtitle="Ações irreversíveis" />
        <div className="p-5 text-sm text-dim-2">
          Exclusão de conta não disponível via UI — acesse Supabase diretamente.
          Delete em <code>dmflow.accounts</code> faz cascade em tudo.
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium text-fg">{label}</label>
        {hint && <span className="text-tiny text-dim-2">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full bg-bg-1 border border-line-2 rounded-lg px-3 py-2 text-sm placeholder:text-dim-2 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-colors"
    />
  );
}

function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-dim-2 text-tiny uppercase tracking-wider">
        {label}
      </span>
      <code
        translate="no"
        className="bg-bg-1 border border-line rounded px-2 py-1 text-tiny truncate max-w-[60%]"
      >
        {value}
      </code>
    </div>
  );
}

function IntegrationRow({
  name,
  description,
  connected,
}: {
  name: string;
  description: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-tiny text-dim-2 mt-0.5">{description}</div>
      </div>
      <StatusPill
        tone={connected ? "good" : "dim"}
        label={connected ? "conectado" : "em breve"}
      />
    </div>
  );
}
