/**
 * ETAPA 4K — Cliente concentrado da nuvem (`public.user_app_state`).
 *
 * TODA conversa com o Supabase sobre dados operacionais passa por aqui —
 * nenhum componente ou store acessa a tabela diretamente. Usa o browser
 * client da 4J sob a sessão autenticada + RLS; jamais service role/segredos.
 *
 * Operações:
 *   - `fetchCloudState`        → leitura do row da conta;
 *   - `createInitialCloudState`→ primeiro envio (recheck + INSERT revision 1);
 *   - `saveCloudStateCAS`      → escrita otimista (UPDATE com revision exata);
 *   - `getAuthenticatedUserId` → usuário dono das operações.
 */
import { createClient as createBrowserClient } from "../supabase/client";
import { validateCanonicalAppState, CLOUD_PAYLOAD_VERSION, type CanonicalCloudPayload } from "./canonical";
import type { ParsedBackup } from "../backup";

/** Tabela canônica da conta (migration 4J — nenhuma alteração de banco aqui). */
export const CLOUD_TABLE = "user_app_state";

const CLOUD_COLUMNS = "user_id,payload,payload_version,revision,updated_at";

/**
 * Superfície mínima usada da API de dados (o client real e os doubles de
 * teste implementam este formato encadeável).
 */
export interface CloudDataClient {
  from(table: string): {
    select(columns: string): unknown;
    // O encadeamento concreto (`eq`/`maybeSingle`/`insert`/`update`) segue o
    // formato do construtor de consultas do Supabase.
    [key: string]: unknown;
  };
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
}

/** Cria o client de dados da sessão atual (4J: URL + publishable key). */
export function getSyncClient(): CloudDataClient {
  return createBrowserClient() as unknown as CloudDataClient;
}

export interface CloudRow {
  user_id: string;
  payload: unknown;
  payload_version: number;
  revision: number;
  updated_at: string;
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return "Falha de comunicação com a nuvem.";
}

/** Normaliza o row remoto; formato inesperado → null (tratado como inválido). */
function normalizeRow(userId: string, data: unknown): CloudRow | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.user_id !== userId) return null;
  if (row.payload_version !== CLOUD_PAYLOAD_VERSION) return null;
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 0) {
    return null;
  }
  if (typeof row.updated_at !== "string") return null;
  return {
    user_id: userId,
    payload: row.payload,
    payload_version: CLOUD_PAYLOAD_VERSION,
    revision: row.revision,
    updated_at: row.updated_at,
  };
}

export type FetchCloudResult =
  | { status: "not_found" }
  | { status: "valid"; row: CloudRow; parsed: ParsedBackup }
  | { status: "invalid"; row: CloudRow | null }
  | { status: "error"; error: string };

/**
 * Lê o estado cloud da conta autenticada. `error` (rede/API) NUNCA é
 * relatado como `not_found` — erro de rede não autoriza criar row novo.
 */
export async function fetchCloudState(
  db: CloudDataClient,
  userId: string,
): Promise<FetchCloudResult> {
  try {
    const query = db.from(CLOUD_TABLE).select(CLOUD_COLUMNS) as {
      eq(col: string, value: string): { maybeSingle(): Promise<{ data: unknown; error: unknown }> };
    };
    const { data, error } = await query.eq("user_id", userId).maybeSingle();
    if (error) return { status: "error", error: messageOf(error) };
    if (data === null || data === undefined) return { status: "not_found" };
    const row = normalizeRow(userId, data);
    if (!row) return { status: "invalid", row: null };
    const validated = validateCanonicalAppState(row.payload);
    if (!validated.ok) return { status: "invalid", row };
    return { status: "valid", row, parsed: validated.parsed };
  } catch (error) {
    return { status: "error", error: messageOf(error) };
  }
}

export type CreateCloudResult =
  | { status: "created"; revision: 1 }
  | { status: "exists"; row: CloudRow | null }
  | { status: "error"; error: string };

function isDuplicateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  return typeof e.message === "string" && e.message.toLowerCase().includes("duplicate");
}

/**
 * Primeiro envio: re-lê o remoto imediatamente antes e só insere se continuar
 * sem row (revision 1). Se o row surgiu no caminho (duplicado), NUNCA
 * sobrescreve — devolve `exists` para o fluxo de colisão decidir.
 */
export async function createInitialCloudState(
  db: CloudDataClient,
  userId: string,
  payload: CanonicalCloudPayload,
): Promise<CreateCloudResult> {
  try {
    const recheck = await fetchCloudState(db, userId);
    if (recheck.status !== "not_found") {
      if (recheck.status === "valid" || recheck.status === "invalid") {
        return { status: "exists", row: recheck.status === "valid" ? recheck.row : recheck.row };
      }
      return { status: "error", error: recheck.error };
    }
    const table = db.from(CLOUD_TABLE) as unknown as {
      insert(values: Record<string, unknown>): {
        select(columns?: string): Promise<{ data: unknown; error: unknown }>;
      };
    };
    const { error } = await table
      .insert({
        user_id: userId,
        payload,
        payload_version: CLOUD_PAYLOAD_VERSION,
        revision: 1,
      })
      .select(CLOUD_COLUMNS);
    if (error) {
      if (isDuplicateError(error)) {
        const again = await fetchCloudState(db, userId);
        if (again.status === "valid" || again.status === "invalid") {
          return { status: "exists", row: again.status === "valid" ? again.row : again.row };
        }
      }
      return { status: "error", error: messageOf(error) };
    }
    return { status: "created", revision: 1 };
  } catch (error) {
    return { status: "error", error: messageOf(error) };
  }
}

export type SaveCloudResult =
  | { status: "saved"; revision: number }
  | { status: "conflict"; remote: CloudRow | null }
  | { status: "error"; error: string };

/**
 * Escrita otimista (compare-and-swap): atualiza SOMENTE se a revision remota
 * ainda for `baseRevision`, gravando `baseRevision + 1`. Zero rows tocados =
 * conflito (outro dispositivo avançou). NUNCA atualiza só por `user_id`.
 */
export async function saveCloudStateCAS(
  db: CloudDataClient,
  userId: string,
  payload: CanonicalCloudPayload,
  baseRevision: number,
): Promise<SaveCloudResult> {
  const nextRevision = baseRevision + 1;
  try {
    const table = db.from(CLOUD_TABLE) as unknown as {
      update(values: Record<string, unknown>): {
        eq(col: string, value: string | number): {
          eq(col: string, value: string | number): {
            select(columns: string): Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
    };
    const { data, error } = await table
      .update({
        payload,
        payload_version: CLOUD_PAYLOAD_VERSION,
        revision: nextRevision,
      })
      .eq("user_id", userId)
      .eq("revision", baseRevision)
      .select(CLOUD_COLUMNS);
    if (error) return { status: "error", error: messageOf(error) };
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 1) return { status: "saved", revision: nextRevision };
    // Zero rows: a revision remota avançou — busca o row atual para o motor
    // decidir entre falso conflito (conteúdo idêntico) e conflito real.
    const remote = await fetchCloudState(db, userId);
    return { status: "conflict", remote: remote.status === "valid" ? remote.row : null };
  } catch (error) {
    return { status: "error", error: messageOf(error) };
  }
}

/**
 * Usuário autenticado dono das operações (fonte: a sessão Supabase — nunca um
 * `user_id` arbitrário vindo da UI). Null quando sem sessão ou em falha.
 */
export async function getAuthenticatedUserId(db: CloudDataClient): Promise<string | null> {
  try {
    const { data } = await db.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}
