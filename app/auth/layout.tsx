import Link from "next/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-6">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute bottom-[-200px] right-[-200px] h-[500px] w-[500px] rounded-full bg-violet/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="flex items-center justify-center gap-2.5 mb-6"
        >
          <Logo size={40} />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight">DMFlow</span>
            <span className="text-tiny text-dim-2 font-mono">v0.4 · SaaS</span>
          </div>
        </Link>
        {children}
      </div>
    </div>
  );
}
