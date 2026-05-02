# DMFlow

Automação estilo ManyChat: alguém comenta no teu post do Instagram → responde publicamente **+** manda DM privada automática.

Stack: Next.js 16 · Supabase (schema `dmflow`) · Meta Graph API v21.

---

## Como funciona

```
Instagram comment
       │
       ▼
 Meta webhook (POST /api/webhook/instagram)
       │
       ├── valida HMAC (X-Hub-Signature-256)
       ├── acha account pelo ig_business_id
       ├── escolhe rule por keyword/post_id
       ├── POST /{comment_id}/replies          → resposta pública
       ├── POST /{ig_business_id}/messages
       │   com recipient.comment_id            → DM privada
       └── grava event em dmflow.events
```

Uma vez por comentário (Meta regra: `private_replies` só pode ser usado 1x por `comment_id`).

---

## Setup

### 1. Supabase

Projeto: **Geek Academy** (`zoknypleoribwomifzgi`)
Schema: `dmflow` (já criado via MCP)
Tabelas: `accounts`, `rules`, `events`

Account já seedada:
- `id` = `b5371147-07f8-4fa8-9494-f8f22713d455`
- `ig_business_id` = `17841400100030080`
- `verify_token` = `dmflow_verify_56645f0545ef9ed1`

Rule de exemplo já seedada: keyword `QUERO` → reply `Te mandei no direct 👇` + DM com botão pra `geek-os.geekacademy.site`.

### 2. Env vars

Copiar `.env.local.example` pra `.env.local` e preencher:

```bash
SUPABASE_URL=https://zoknypleoribwomifzgi.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<pegar em Supabase → Settings → API → service_role>
NEXT_PUBLIC_SUPABASE_URL=https://zoknypleoribwomifzgi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_2Pxy4cdtCGUQIwElen1_Vg_7I-o-UmR
```

### 3. Dev local

```bash
npm install
npm run dev
# abre http://localhost:3000/dashboard
```

### 4. Deploy Vercel

```bash
vercel login            # 1x
vercel link --yes       # cria projeto dmflow-app
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel deploy --prod
```

Anotar a URL que o Vercel retorna (ex: `https://dmflow-app.vercel.app`).

---

## Configurar Meta Webhook

### 1. Meta for Developers → App "Automação n8n Geek" (ID `1281970744036267`)

Menu lateral → **Webhooks** → **Instagram**

- Callback URL: `https://<tua-vercel-url>/api/webhook/instagram`
- Verify Token: `dmflow_verify_56645f0545ef9ed1`
- Clicar **Verificar e salvar** — deve passar (nosso GET responde challenge)

### 2. Subscribir ao campo `comments`

Na mesma tela de webhook, marcar o campo **`comments`** e **Subscribir**.

### 3. Ligar o webhook à conta IG

```bash
curl -X POST \
  "https://graph.facebook.com/v21.0/17841400100030080/subscribed_apps?subscribed_fields=comments&access_token=$TOKEN"
```

Substitua `$TOKEN` pelo access token da conta (mesmo que tá em `deploy_and_post.py`).

### 4. Testar

1. Ir num post teu do @andreywestley
2. Comentar "Eu QUERO isso"
3. Em até 5s deve aparecer:
   - Resposta pública: "Te mandei no direct 👇"
   - DM privada com botão pra GEEK-OS
4. Conferir em `/dashboard` — evento registrado.

---

## Endpoints

| Rota | Método | O que faz |
|---|---|---|
| `/api/webhook/instagram` | GET | Handshake Meta (verify_token) |
| `/api/webhook/instagram` | POST | Recebe comment, dispara reply+DM |
| `/dashboard` | GET | Lista últimos 100 eventos |
| `/dashboard/rules` | GET/POST | CRUD regras |

---

## Limites importantes (Meta)

- **Private Reply**: 1x por `comment_id`. Se já respondeu, Meta rejeita.
- **Mensagens proativas**: só 7 dias após o comentário. Depois disso, precisa tag `HUMAN_AGENT`.
- **Rate limit**: 200 chamadas/hora/app por padrão.
- **App Review**: pra virar SaaS vai precisar do Meta aprovar `instagram_manage_messages` pra outras contas IG além da tua.

---

## Ponte pro SaaS

Schema já é multi-tenant:

- `accounts` pode crescer pra N contas — cada uma com seu `ig_access_token`, `app_secret`, `verify_token`
- `rules` e `events` são isolados por `account_id`
- Webhook valida signature com `app_secret` **da conta certa** (achada via `ig_business_id` que vem no payload)

Pra virar SaaS de verdade:
1. OAuth Meta (Login with Facebook) pra user conectar a conta IG dele
2. Geração automática de `verify_token` único por account
3. Subscribir o app Meta nos `comments` da conta conectada via API
4. Cobrança (Stripe / Lastlink)
5. UI onboarding + dashboard multi-user

A base do webhook já aguenta isso sem mudança.
