export const metadata = {
  title: "Termos de Uso — DMFlow",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-fg">
      <h1 className="text-3xl font-semibold mb-2">Termos de Uso</h1>
      <p className="text-dim text-sm mb-8">Última atualização: 23 de abril de 2026</p>

      <section className="space-y-6 text-[15px] leading-relaxed">
        <p>
          Ao usar o DMFlow, você concorda com estes termos. O serviço é oferecido
          pela Geek Academy como ferramenta de automação de respostas a
          comentários e mensagens do Instagram.
        </p>

        <div>
          <h2 className="text-xl font-semibold mb-2">1. Uso aceitável</h2>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>Não usar para spam, fraude, phishing ou violação de direitos</li>
            <li>Respeitar as políticas da Meta/Instagram</li>
            <li>Só conectar contas Instagram que você é dono ou administra legitimamente</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">2. Responsabilidade</h2>
          <p>
            O DMFlow é fornecido "como está". Não nos responsabilizamos por suspensões
            de conta do Instagram causadas por uso inadequado da ferramenta.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">3. Alterações</h2>
          <p>
            Podemos atualizar estes termos. Mudanças relevantes serão comunicadas
            com 30 dias de antecedência por email ou no painel.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">4. Contato</h2>
          <p>
            <a href="mailto:contato@geekacademy.site" className="text-accent underline">
              contato@geekacademy.site
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
