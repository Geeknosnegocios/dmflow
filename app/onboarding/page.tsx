import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, getUserAccounts } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { Card } from "@/components/viz";
import { CheckCircle2, AtSign } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const profile = await requireProfile();
  const accounts = await getUserAccounts(profile.id);

  // If user already has account, skip onboarding
  if (accounts.length > 0) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-lg space-y-6">
        <Link href="/" className="flex items-center justify-center gap-2.5">
          <Logo size={44} />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold">DMFlow</span>
            <span className="text-tiny text-dim-2 font-mono">bem-vindo</span>
          </div>
        </Link>

        <Card className="p-6 space-y-5">
          <div className="space-y-1 text-center">
            <div className="inline-flex h-12 w-12 rounded-full bg-good-dim text-good items-center justify-center mb-2">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Conta criada, {profile.full_name?.split(" ")[0] ?? "bem-vindo"}!
            </h1>
            <p className="text-dim-2 text-sm">
              Último passo: conectar seu Instagram profissional pra começar a automatizar.
            </p>
          </div>

          <a
            href="/auth/instagram/start"
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-pink-500 via-orange-500 to-yellow-500 text-white font-semibold py-3 text-sm hover:opacity-90 transition-opacity"
          >
            <AtSign className="h-4 w-4" />
            Conectar Instagram
          </a>

          <div className="rounded-lg bg-bg-1 border border-line p-3 text-tiny text-dim-2 space-y-1">
            <div className="font-medium text-fg mb-1">O que vai acontecer:</div>
            <div>• Redireciona pro Meta/Instagram</div>
            <div>• Você autoriza DMFlow a acessar sua conta profissional</div>
            <div>• Volta aqui com a conta conectada</div>
            <div>• Pode começar a criar regras imediatamente</div>
          </div>

          <div className="text-tiny text-dim-2 text-center">
            Exige conta <strong>Instagram Business ou Creator</strong> (setting no app IG).
          </div>
        </Card>

        <div className="text-center text-tiny text-dim-2">
          <Link href="/auth/logout" className="hover:text-fg">
            Sair
          </Link>
        </div>
      </div>
    </div>
  );
}
