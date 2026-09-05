import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CloudSyncGate, CloudSyncProvider } from "@/components/cloud-sync-provider";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ETAPA 4J — proteção server-side das rotas operacionais: sem sessão,
// redirect para /entrar (defesa em profundidade junto com src/proxy.ts).
// O localStorage continua sendo a fonte de verdade operacional nesta
// etapa; este layout NUNCA lê nem escreve dados do app.
//
// ETAPA 4K — o provedor/portão de sync envolve o shell: a conta autenticada
// é resolvida contra o cache local e a nuvem antes de exibir conteúdo
// operacional (sem flash de dados de outra conta/dispositivo).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (isSupabaseConfigured()) {
    const { createClient } = await import("@/lib/supabase/server");
    let user = null;
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch {
      // Falha transitória ao ler a sessão: trata como sem sessão abaixo.
    }
    if (!user) redirect("/entrar");
  }

  return (
    <CloudSyncProvider>
      <CloudSyncGate>
        <AppShell>{children}</AppShell>
      </CloudSyncGate>
    </CloudSyncProvider>
  );
}
