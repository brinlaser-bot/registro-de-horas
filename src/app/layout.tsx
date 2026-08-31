import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { SpecialReleaseProvider } from "@/components/special-release-confirm";

export const metadata: Metadata = {
  title: {
    default: "Meu Horário — Controle de ponto",
    template: "%s · Meu Horário",
  },
  description:
    "Controle pessoal de horário de trabalho: registre entradas e saídas, acompanhe seu saldo de horas e compense excedentes seguindo as regras da empresa.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <ToastProvider>
          <SpecialReleaseProvider>{children}</SpecialReleaseProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
