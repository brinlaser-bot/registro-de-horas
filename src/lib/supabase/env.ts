/**
 * ETAPA 4J — Fundação Supabase (somente nomes de env, sem segredos).
 *
 * Regras desta etapa:
 * - consumir SOMENTE NEXT_PUBLIC_SUPABASE_URL e
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 * - NUNCA ler process.env em import-time de forma que `next build` quebre
 *   quando as variáveis não estiverem presentes (sandbox Arena);
 * - em ambiente não configurado, retornar mensagem clara em runtime,
 *   sem revelar valores.
 *
 * NENHUM segredo (chave de serviço, segredo de API, senhas) pode existir no repo.
 */

export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

/** Mensagem padrão exibida quando o ambiente ainda não foi configurado. */
export const SUPABASE_NOT_CONFIGURED_MSG =
  "O acesso ainda não está configurado neste ambiente.";

/** Lê a URL do Supabase em runtime (nunca em import-time). */
export function getSupabaseUrl(): string {
  return (process.env[SUPABASE_URL_ENV] ?? "").trim();
}

/** Lê a publishable key do Supabase em runtime (nunca em import-time). */
export function getSupabasePublishableKey(): string {
  return (process.env[SUPABASE_PUBLISHABLE_KEY_ENV] ?? "").trim();
}

/** `true` quando as duas envs públicas estão presentes. */
export function isSupabaseConfigured(): boolean {
  return getSupabaseUrl().length > 0 && getSupabasePublishableKey().length > 0;
}

/**
 * Valida a configuração em runtime. Lança erro controlado (sem vazar
 * valores) quando as envs estão ausentes — quem chama traduz para a
 * mensagem amigável em português.
 */
export function requireSupabaseEnv(): { url: string; publishableKey: string } {
  const url = getSupabaseUrl();
  const publishableKey = getSupabasePublishableKey();
  if (!url || !publishableKey) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MSG);
  }
  return { url, publishableKey };
}
