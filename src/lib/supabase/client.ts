"use client";

/**
 * ETAPA 4J — Supabase browser client (App Router).
 *
 * Usa SOMENTE URL + publishable key via env (runtime, nunca em
 * import-time). A sessão Supabase (cookies) é a autoridade de
 * autenticação — NENHUMA autenticação caseira em localStorage.
 */
import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

export function createClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
