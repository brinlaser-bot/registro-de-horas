/**
 * ETAPA 4J — Rota pública de login (/entrar).
 *
 * Server Component: se já houver sessão, redireciona para /.
 * Caso contrário renderiza o formulário de e-mail + código OTP.
 * Em ambiente não configurado, apenas exibe o formulário (o erro de
 * configuração é tratado em runtime no envio, sem quebrar o build).
 */
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = {
  title: "Entrar",
  description: "Entre no Meu Horário com um código enviado ao seu e-mail.",
};

export default async function EntrarPage() {
  if (isSupabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) redirect("/");
    } catch {
      // Sem sessão válida ou falha transitória: permanece na tela de login.
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 py-10">
      <LoginForm />
    </main>
  );
}
