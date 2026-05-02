import Link from "next/link";
import { Logo } from "@/components/logo";

export default function Home() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Ambient gradient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-[-100px] right-[-200px] h-[500px] w-[500px] rounded-full bg-violet/10 blur-[120px]" />
      </div>

      <div className="relative z-10">
        {/* Top bar */}
        <header className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={32} />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">DMFlow</span>
              <span className="text-tiny text-dim-2 font-mono">v0.3 · beta</span>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-line-2 hover:border-accent/40 px-3 py-1.5 text-sm hover:bg-white/5 transition-colors"
          >
            Abrir dashboard →
          </Link>
        </header>

        {/* Hero */}
        <main id="main" className="mx-auto max-w-6xl px-6 pt-16 pb-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-surface px-3 py-1 text-tiny uppercase tracking-widest text-dim-2">
              <span className="h-1.5 w-1.5 rounded-full bg-good pulse-dot" />
              sistema ativo
            </span>
            <h1 className="mt-6 text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight">
              Comentário vira DM.{" "}
              <span className="bg-gradient-to-r from-accent via-accent to-violet bg-clip-text text-transparent">
                Lead vira cliente.
              </span>
            </h1>
            <p className="mt-6 text-dim-2 text-lg max-w-2xl">
              Automação própria de respostas do Instagram. Comentário com
              keyword, primeira DM, resposta de story — responde público e
              manda direct privado com link trackeado. Sem limite de regras, sem
              mensalidade.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg bg-accent hover:bg-accent/90 text-accent-ink font-semibold px-5 py-3 text-sm transition-colors"
              >
                Abrir dashboard
              </Link>
              <Link
                href="/dashboard/rules"
                className="rounded-lg border border-line-2 hover:border-accent/40 px-5 py-3 text-sm font-medium hover:bg-white/5 transition-colors"
              >
                Gerenciar regras
              </Link>
            </div>
          </div>

          {/* Feature grid */}
          <section className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="Funcionalidades">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="rounded-xl border border-line bg-surface/80 backdrop-blur p-6 hover:border-line-2 transition-colors"
              >
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-tiny font-mono text-accent bg-accent-dim rounded px-1.5 py-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-tiny text-dim-2 uppercase tracking-wider">
                    {f.tag}
                  </span>
                </div>
                <h2 className="text-lg font-semibold mb-2">{f.title}</h2>
                <p className="text-sm text-dim-2 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </section>

          {/* Capabilities strip */}
          <section className="mt-16 rounded-xl border border-line bg-surface/60 backdrop-blur p-6">
            <div className="text-tiny uppercase tracking-wider text-dim-2 mb-4">
              Dentro da caixa
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                ["Reply público", "Responde o comentário no post"],
                ["DM privada", "Manda direct com até 3 botões"],
                ["Click tracking", "Mede conversão botão-a-botão"],
                ["Token refresh", "Renovação automática 60d"],
                ["Heatmap", "Quando seus seguidores engajam"],
                ["Alertas email", "Sabe quando algo quebra"],
                ["Export CSV", "Leva os dados pra qualquer lugar"],
                ["Multi-tenant", "Pronto pra virar SaaS"],
              ].map(([title, sub]) => (
                <div key={title}>
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-tiny text-dim-2 mt-1">{sub}</div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <footer className="mx-auto max-w-6xl px-6 py-8 text-tiny text-dim-2 flex justify-between border-t border-line">
          <span>DMFlow · Geek Academy · Built with Next.js + Supabase</span>
          <span className="font-mono">
            <Link href="/privacy" className="hover:text-fg">
              privacy
            </Link>
            {" · "}
            <Link href="/terms" className="hover:text-fg">
              terms
            </Link>
          </span>
        </footer>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    tag: "trigger",
    title: "Comentário ou DM",
    body: "Alguém comenta uma keyword no teu post ou manda primeira DM. O webhook Meta dispara o fluxo em < 2s.",
  },
  {
    tag: "match",
    title: "Match inteligente",
    body: "Regras por palavra-chave, post específico ou story específico. Prioridades configuráveis. Multi-tenant.",
  },
  {
    tag: "send",
    title: "Reply + DM + track",
    body: "Responde publicamente, manda DM privada com botões trackeados e mede conversão até o clique final.",
  },
];
