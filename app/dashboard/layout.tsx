import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";
import { StatusPill } from "@/components/viz";
import { Logo } from "@/components/logo";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/toaster";
import { readAndClearFlash } from "@/lib/flash";
import { requireProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Account } from "@/types/db";

async function getAppStatus(userId: string) {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("accounts")
    .select("ig_username, ig_token_expires_at, active")
    .eq("owner_user_id", userId)
    .eq("active", true)
    .limit(1)
    .maybeSingle<Pick<Account, "ig_username" | "ig_token_expires_at" | "active">>();

  if (!data) {
    return { tone: "dim" as const, label: "Sem conta", username: null };
  }
  const daysLeft = data.ig_token_expires_at
    ? Math.round(
        (new Date(data.ig_token_expires_at).getTime() - Date.now()) / 86400000
      )
    : null;

  if (daysLeft === null) {
    return { tone: "violet" as const, label: "Ativo", username: data.ig_username };
  }
  if (daysLeft < 7)
    return {
      tone: "danger" as const,
      label: `Token ${daysLeft}d`,
      username: data.ig_username,
    };
  if (daysLeft < 14)
    return {
      tone: "warn" as const,
      label: `Token ${daysLeft}d`,
      username: data.ig_username,
    };
  return {
    tone: "good" as const,
    label: "Ao vivo",
    username: data.ig_username,
    pulse: true,
  };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  // If user has no connected account, route to onboarding
  const sb = supabaseAdmin();
  const { data: accountCheck } = await sb
    .from("accounts")
    .select("id")
    .eq("owner_user_id", profile.id)
    .limit(1)
    .maybeSingle();
  if (!accountCheck) {
    redirect("/onboarding");
  }

  const [status, flash] = await Promise.all([
    getAppStatus(profile.id),
    readAndClearFlash(),
  ]);

  const navItems = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/analytics", label: "Analytics" },
    { href: "/dashboard/leaderboard", label: "Leaderboard" },
    { href: "/dashboard/rules", label: "Regras" },
    { href: "/dashboard/stories", label: "Stories" },
    { href: "/dashboard/settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 h-14 flex items-center justify-between gap-6">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <Logo size={28} />
              <div className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-good border-2 border-bg pulse-dot" />
            </div>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">DMFlow</span>
              <span className="text-tiny text-dim-2 font-mono">v0.3</span>
            </div>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 rounded-lg text-dim-2 hover:text-fg hover:bg-white/5 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Status + account + cmd palette */}
          <div className="flex items-center gap-3">
            {profile.is_admin && (
              <Link
                href="/admin"
                className="hidden sm:inline text-tiny rounded-md border border-violet/40 bg-violet-dim text-violet px-2 py-1 font-medium hover:bg-violet/20 transition-colors"
              >
                admin
              </Link>
            )}
            <CommandPalette
              items={[
                { label: "Overview", href: "/dashboard", hint: "⌘ 1" },
                { label: "Analytics", href: "/dashboard/analytics", hint: "⌘ 2" },
                { label: "Leaderboard", href: "/dashboard/leaderboard", hint: "⌘ 3" },
                { label: "Regras", href: "/dashboard/rules", hint: "⌘ 4" },
                { label: "Stories", href: "/dashboard/stories", hint: "⌘ 5" },
                { label: "Settings", href: "/dashboard/settings", hint: "⌘ ," },
                { label: "Exportar eventos", href: "/api/admin/export?kind=events" },
                { label: "Exportar cliques", href: "/api/admin/export?kind=clicks" },
              ]}
            />
            {status.username && (
              <span className="hidden md:inline text-tiny text-dim-2 font-mono">
                @{status.username}
              </span>
            )}
            <StatusPill
              tone={status.tone}
              label={status.label}
              pulse={status.tone === "good"}
            />
            <details className="relative">
              <summary className="list-none cursor-pointer">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent/40 to-violet/40 flex items-center justify-center text-tiny font-bold uppercase hover:ring-2 hover:ring-accent/40 transition-all">
                  {(profile.full_name || profile.email).slice(0, 2).toUpperCase()}
                </div>
              </summary>
              <div className="absolute right-0 top-10 rounded-xl border border-line-2 bg-surface shadow-2xl w-56 p-1 z-50">
                <div className="px-3 py-2 border-b border-line">
                  <div className="text-sm font-medium truncate">
                    {profile.full_name || "—"}
                  </div>
                  <div className="text-tiny text-dim-2 truncate">
                    {profile.email}
                  </div>
                  <div className="mt-1.5">
                    <StatusPill
                      tone={profile.plan_slug === "free" ? "dim" : "accent"}
                      label={`plano ${profile.plan_slug}`}
                    />
                  </div>
                </div>
                <Link
                  href="/dashboard/settings"
                  className="block px-3 py-1.5 text-sm text-dim-2 hover:text-fg hover:bg-white/5 rounded-md transition-colors"
                >
                  Configurações
                </Link>
                <Link
                  href="/dashboard/billing"
                  className="block px-3 py-1.5 text-sm text-dim-2 hover:text-fg hover:bg-white/5 rounded-md transition-colors"
                >
                  Plano e billing
                </Link>
                <a
                  href="/auth/logout"
                  className="block px-3 py-1.5 text-sm text-danger hover:bg-danger/5 rounded-md transition-colors"
                >
                  Sair
                </a>
              </div>
            </details>
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="md:hidden flex items-center gap-1 px-4 pb-2 text-sm overflow-x-auto no-scrollbar -webkit-overflow-scrolling-touch">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 rounded-lg text-dim-2 hover:text-fg hover:bg-white/5 transition-colors whitespace-nowrap flex-shrink-0"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-6 py-8">
        {children}
      </main>

      <Toaster flash={flash} />

      <footer className="mx-auto max-w-7xl px-6 py-8 text-tiny text-dim-2 flex justify-between">
        <span>DMFlow · Geek Academy</span>
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
  );
}
