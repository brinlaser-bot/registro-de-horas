/**
 * ETAPA 4J — Supabase server client (App Router + Next 16).
 *
 * Mecanismo SSR/cookies compatível com @supabase/ssr: lê os cookies da
 * sessão no servidor e permite o refresh via proxy (src/proxy.ts).
 * Envs lidas em runtime — nunca em import-time — para que `next build`
 * não quebre em ambiente não configurado.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseEnv } from "./env";

export async function createClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Chamado a partir de um Server Component: a escrita de cookies
          // é ignorada aqui — o proxy (src/proxy.ts) faz o refresh da sessão.
        }
      },
    },
  });
}
