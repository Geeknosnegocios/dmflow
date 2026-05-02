export const metadata = {
  title: "Política de Privacidade — DMFlow",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-fg">
      <h1 className="text-3xl font-semibold mb-2">Política de Privacidade</h1>
      <p className="text-dim text-sm mb-8">Última atualização: 23 de abril de 2026</p>

      <section className="space-y-6 text-[15px] leading-relaxed">
        <p>
          O DMFlow ("nós", "nosso") é uma ferramenta de automação de respostas a
          comentários e mensagens do Instagram, operada pela Geek Academy. Esta
          política descreve como tratamos dados ao operar o serviço.
        </p>

        <div>
          <h2 className="text-xl font-semibold mb-2">1. Dados coletados</h2>
          <p>Ao processar automações, o DMFlow pode acessar e armazenar:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>ID da conta Instagram profissional conectada ao serviço</li>
            <li>ID e conteúdo de comentários públicos em posts da conta conectada</li>
            <li>ID de usuários que comentaram ou enviaram DM para a conta conectada</li>
            <li>Tokens de acesso da Instagram Graph API (criptografados em trânsito e em repouso)</li>
            <li>Logs técnicos dos webhooks recebidos (para auditoria e debug)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">2. Uso dos dados</h2>
          <p>Os dados são usados exclusivamente para:</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Executar as automações configuradas pelo dono da conta</li>
            <li>Enviar respostas públicas e mensagens privadas conforme regras definidas</li>
            <li>Exibir histórico de eventos no painel administrativo</li>
            <li>Depurar falhas técnicas</li>
          </ul>
          <p className="mt-2">Nenhum dado é vendido, compartilhado com terceiros ou usado para publicidade de terceiros.</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">3. Retenção</h2>
          <p>
            Logs de webhook e eventos são retidos por 90 dias e depois apagados. Tokens
            de acesso são mantidos enquanto a conexão com o Instagram estiver ativa.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">4. Compartilhamento</h2>
          <p>
            Dados só são compartilhados com a Meta Platforms (Instagram/Facebook)
            através das APIs oficiais para executar as automações. Processadores
            subcontratados: Vercel (hospedagem) e Supabase (banco de dados).
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">5. Direitos do usuário</h2>
          <p>
            Usuários cujos dados foram processados pelo DMFlow podem solicitar
            acesso, correção ou exclusão por email:{" "}
            <a href="mailto:contato@geekacademy.site" className="text-accent underline">
              contato@geekacademy.site
            </a>
            . Solicitações são atendidas em até 15 dias.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">6. Instagram Platform Policy</h2>
          <p>
            O DMFlow opera em conformidade com a{" "}
            <a
              href="https://developers.facebook.com/terms/"
              className="text-accent underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              Plataforma Meta
            </a>{" "}
            e segue todas as restrições de envio de mensagens do Instagram, incluindo
            a janela de 7 dias para respostas privadas a comentários e limitações de
            mensagens proativas.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">7. Exclusão de dados</h2>
          <p>
            Para remover seus dados imediatamente, o dono da conta Instagram conectada
            pode:
          </p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Revogar permissões do app em Configurações do Instagram → Segurança → Apps e sites</li>
            <li>Enviar pedido por email para contato@geekacademy.site</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">8. Contato</h2>
          <p>
            Controlador: Geek Academy<br />
            Email:{" "}
            <a href="mailto:contato@geekacademy.site" className="text-accent underline">
              contato@geekacademy.site
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
