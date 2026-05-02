import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "DMFlow — Automação de DMs Instagram",
  description:
    "Responde comentários automaticamente e manda DM privada com link trackeado.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0b10",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only fixed top-3 left-3 z-[100] rounded-md bg-accent text-accent-ink px-3 py-2 text-sm font-semibold"
        >
          Pular para conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
