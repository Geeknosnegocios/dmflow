# Corte dos publicadores de Instagram

Destino: Supabase Geek Academy `zoknypleoribwomifzgi`, conta ativa `@andreyogeek`.

O corte usa quatro fases. O dispatcher de Geek Academy começa desabilitado pela migration; o corte não habilita a publicação enquanto qualquer publicador antigo estiver ativo.

## Estado de origem conferido em 28/10/2026

- Geek Academy tinha cinco jobs ativos `post-story-0900`, `1200`, `1500`, `1800` e `2100`. Eles permanecem ativos.
- Geek Academy também tinha o job cross-project `publish-scheduled-daily-1005-brt`, que invocava `publish-scheduled-cron` e lia `scheduled_publications` de outro projeto.
- Geeknosnegocios tinha três jobs de Instagram ativos: `publish-carousel-cron`, `post-carrossel-11h` e `post-carrossel-19h`. Não havia registros futuros em `scheduled_publications` nem em `carrossel_queue`.
- As linhas antigas `GI-019` e `TIER-2026-09-18` em `processing` são preservadas como histórico. Não são reabertas nem migradas para uma fila executável.
- O projeto Vercel `dmflow` tinha quatro horários para `/api/cron/publish-reels`. A branch remove esses horários e a rota antiga retorna HTTP 410.

## Pré-requisitos antes do corte

1. Merge da PR com os checks Node, Deno e Postgres 17 verdes.
2. Deployment Production do Vercel marcado `READY` com este commit.
3. Na tela **Settings → Cron Jobs** do projeto Vercel `dmflow`, confirmar zero rotas `/api/cron/publish-reels`. O script exige a confirmação manual `--vercel-crons-removed`, porque o estado de Cron Jobs é conferido no painel da Vercel.
4. O manifesto Reelsflow foi verificado e `schedule-batch --commit` continuará sendo uma ação deliberada. Lotes de Reels exigem primeiro aprovação explícita pelo endpoint `/api/v1/reels/approve-batch`, autenticado por uma API key `dmf_` do proprietário. O controller de lote nunca cria aprovações durante `schedule-batch`.
5. As migrations existentes do projeto incluem histórico de outros sistemas que não pertence a este repositório. Por isso, `supabase db push` não deve marcar ou reescrever versões antigas. O utilitário aplica somente as migrations Instagram deste repositório e registra somente essas versões.

## Dry run

Execute a partir da raiz deste repositório. Aponte `--reelsflow-env` para o `.env.local` já existente do Reelsflow; o utilitário lê o valor em memória, confere seu hash com o controller implantado e nunca imprime o valor ou o hash.

```powershell
node scripts/cutover-instagram-publishers.mjs `
  --reelsflow-env "C:\Users\freit\Documents\ChatGPT\Instagram\Reelsflow\.env.local"
```

O dry run consulta somente Geek Academy e Geeknosnegocios e compara o hash do token Reelsflow local com o controller implantado. Ele não altera jobs, tabelas, secrets, Vault, Storage, fila, permissões, nem chama a API da Meta.

## Ativar o novo proprietário

Depois de conferir `READY` e zero crons antigos no painel da Vercel, execute:

```powershell
node scripts/cutover-instagram-publishers.mjs `
  --reelsflow-env "C:\Users\freit\Documents\ChatGPT\Instagram\Reelsflow\.env.local" `
  --vercel-crons-removed `
  --commit
```

O modo `--commit` faz, nesta ordem:

1. Revalida conta, os cinco jobs de Stories, filas antigas, histórico em processamento e a confirmação do deployment Vercel.
2. Aplica as migrations Instagram e registra somente essas versões. O histórico antigo do banco, criado por outros sistemas, é preservado.
3. Confirma que as filas locais não têm itens executáveis, preserva o hash do token Reelsflow, define secrets Edge sem imprimir valores e implanta os workers com o dispatcher ainda desabilitado.
4. Define somente os jobs de publicação antigos dos dois projetos como inativos. Mantém os cinco jobs de Stories e todos os registros históricos; valida novamente que não existe outro publicador legado ativo.
5. Cria o segredo interno do dispatcher no Vault sem imprimir o valor, agenda um único cron `* * * * *` no Geek Academy e habilita o lock por último.

Após o corte, confirme a propriedade única do agendamento com:

```powershell
node scripts/cutover-instagram-publishers.mjs `
  --reelsflow-env "C:\Users\freit\Documents\ChatGPT\Instagram\Reelsflow\.env.local" `
  --vercel-crons-removed `
  --verify
```

O dispatcher escolhe uma fila local de cada vez (carrossel, Reel, Story associado ou permalink), com lock de três minutos. Os Stories editoriais de cinco horários continuam nos seus jobs atuais.

## Verificação pós-corte

Reexecute o utilitário sem `--commit`. Ele confirma que os jobs antigos estão inativos, os cinco slots de Story continuam ativos, há apenas um dispatcher local ativo e o lock está habilitado. Depois, consulte o Instagram e os recibos das filas; uma resposta da API sozinha não comprova publicação.

Se um deploy ou preflight falhar antes de habilitar o dispatcher, o novo job segue desabilitado. Só reative os jobs legados se nenhuma chamada Meta tiver sido feita e não houver linha futura nas filas locais. Depois de qualquer chamada Meta com resultado incerto, reconcilie o recibo e mantenha os workers antigos desligados.
