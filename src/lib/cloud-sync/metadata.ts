/**
 * ETAPA 4K — Metadata local de sincronização (NÃO é dado operacional).
 *
 * Guardada em chave própria do armazenamento local, SEPARADA do cache
 * operacional (`meu-horario:data:v1`) e NUNCA incluída no BACKUP v3:
 *
 *   - `activeUserId` vincula este navegador a UMA conta (impede que outra
 *     conta autenticada aqui veja o cache da anterior);
 *   - `revision` é a última revision confirmada pela nuvem;
 *   - `pending*` guarda a alteração local ainda não enviada (sobrevive a F5
 *     e a fechar/reabrir o navegador).
 *
 * O `user id` da conta autenticada NÃO é segredo.
 */
"use client";

import { useSyncExternalStore } from "react";
import type { BackupPayload } from "../backup";

/** Chave da metadata de sync (fora do backup e do cache operacional). */
export const CLOUD_SYNC_META_KEY = "meu-horario:cloud-sync:v1";

/** Prefixo dos compartimentos por conta (preserva o slot ao trocar de login). */
export const CLOUD_SYNC_STASH_PREFIX = "meu-horario:cloud-sync:stash:v1:";

/** Modo do navegador: local ainda não ativado, ou nuvem como referência. */
export type SyncMode = "local" | "cloud";

/** Estado exibido da sincronização (rótulos em `SYNC_STATUS_LABEL`). */
export type SyncStatus =
  | "not-started"
  | "syncing"
  | "synced"
  | "pending"
  | "conflict"
  | "error";

/**
 * ETAPA 4L — rótulos CURTOS (sidebar/indicadores estreitos): sem truncamento
 * ruim em telas pequenas. O rótulo longo continua nos cartões amplos.
 */
export const SYNC_STATUS_SHORT_LABEL: Record<SyncStatus, string> = {
  "not-started": "Não iniciada",
  syncing: "Sincronizando",
  synced: "Sincronizado",
  pending: "Pendente",
  conflict: "Conflito",
  error: "Erro",
};

/**
 * ETAPA 4L — explicação em linguagem simples do estado atual dos dados.
 * Sem termos técnicos (armazenamento do navegador, revisões, servidor).
 */
export const SYNC_EXPLAIN: Record<SyncStatus, string> = {
  "not-started": "Seus dados estão somente neste dispositivo.",
  syncing: "Seus dados ficam neste dispositivo e sincronizados com sua conta.",
  synced: "Seus dados ficam neste dispositivo e sincronizados com sua conta.",
  pending: "Há alterações neste dispositivo aguardando sincronização.",
  conflict: "Há alterações neste dispositivo e em outro dispositivo.",
  error: "Seus dados estão salvos neste dispositivo.",
};

export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  "not-started": "Sincronização não iniciada",
  syncing: "Sincronizando…",
  synced: "Sincronizado",
  pending: "Pendente de sincronização",
  conflict: "Conflito de sincronização",
  error: "Erro de sincronização",
};

export interface CloudSyncMetadata {
  version: 1;
  /** Conta dona do cache deste navegador (null = slot ainda sem vínculo). */
  activeUserId: string | null;
  mode: SyncMode;
  status: SyncStatus;
  /** Última revision confirmada pela nuvem (null = desconhecida). */
  revision: number | null;
  /** Última revision remota observada (apenas informativa). */
  cloudRevision: number | null;
  /** Base do snapshot pendente: NUNCA avança sem sucesso do CAS. */
  pendingBaseRevision: number | null;
  /** Snapshot canônico ainda não enviado (null = nada pendente). */
  pendingPayload: BackupPayload | null;
  /** Impressão do último snapshot confirmado (evita envios redundantes). */
  lastSyncedFingerprint: string | null;
  /** Carimbo técnico do último sucesso (UTC/ISO — não é data civil). */
  lastSyncedAt: string | null;
  /** Mensagem amigável do último problema (null = sem erro). */
  lastError: string | null;
  /** Carimbo técnico da última escrita desta metadata. */
  updatedAt: string;
}

export interface AccountStash {
  meta: CloudSyncMetadata;
  /** Cópia textual do cache operacional da conta (null = indisponível). */
  cacheRaw: string | null;
  savedAt: string;
}

/* ─────────────────────────────────────────────────────────────
   Backend de armazenamento (localStorage no navegador; memória em SSR/testes).
   Leitura sempre direta do backend — sem cache em módulo — para que F5 e
   reaberturas enxerguem exatamente o que foi persistido.
   ───────────────────────────────────────────────────────────── */

type SimpleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const memoryBackend: SimpleStorage = (() => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
})();

function backend(): SimpleStorage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* armazenamento indisponível — cai para a memória */
  }
  if (typeof window === "undefined") return memoryBackend;
  try {
    return memoryBackend;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultSyncMetadata(): CloudSyncMetadata {
  return {
    version: 1,
    activeUserId: null,
    mode: "local",
    status: "not-started",
    revision: null,
    cloudRevision: null,
    pendingBaseRevision: null,
    pendingPayload: null,
    lastSyncedFingerprint: null,
    lastSyncedAt: null,
    lastError: null,
    updatedAt: nowIso(),
  };
}

function isValidMetadata(value: unknown): value is CloudSyncMetadata {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    m.version === 1 &&
    (m.activeUserId === null || typeof m.activeUserId === "string") &&
    (m.mode === "local" || m.mode === "cloud") &&
    (m.status === "not-started" ||
      m.status === "syncing" ||
      m.status === "synced" ||
      m.status === "pending" ||
      m.status === "conflict" ||
      m.status === "error") &&
    (m.revision === null || (typeof m.revision === "number" && Number.isInteger(m.revision))) &&
    (m.cloudRevision === null ||
      (typeof m.cloudRevision === "number" && Number.isInteger(m.cloudRevision))) &&
    (m.pendingBaseRevision === null ||
      (typeof m.pendingBaseRevision === "number" && Number.isInteger(m.pendingBaseRevision))) &&
    (m.pendingPayload === null || (typeof m.pendingPayload === "object" && !Array.isArray(m.pendingPayload))) &&
    (m.lastSyncedFingerprint === null || typeof m.lastSyncedFingerprint === "string") &&
    (m.lastSyncedAt === null || typeof m.lastSyncedAt === "string") &&
    (m.lastError === null || typeof m.lastError === "string") &&
    typeof m.updatedAt === "string"
  );
}

/** Lê a metadata direto do backend (metadata corrompida → padrão seguro). */
export function getSyncMetadata(): CloudSyncMetadata {
  try {
    const raw = backend()?.getItem(CLOUD_SYNC_META_KEY) ?? null;
    if (!raw) return defaultSyncMetadata();
    const parsed: unknown = JSON.parse(raw);
    if (!isValidMetadata(parsed)) return defaultSyncMetadata();
    // Metadata que alega sucesso precisa ser coerente; incoerência vira erro
    // seguro (nunca "Sincronizado" indevido).
    if (
      parsed.status === "synced" &&
      (parsed.mode !== "cloud" || parsed.revision === null || parsed.pendingPayload !== null)
    ) {
      return { ...parsed, status: "pending", updatedAt: nowIso() };
    }
    return parsed;
  } catch {
    return defaultSyncMetadata();
  }
}

const listeners = new Set<() => void>();

function emitSyncMetadata(): void {
  listeners.forEach((l) => l());
}

function subscribeSyncMetadata(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Persiste a metadata integralmente e avisa os assinantes React. */
export function setSyncMetadata(meta: CloudSyncMetadata): void {
  const next: CloudSyncMetadata = { ...meta, version: 1, updatedAt: nowIso() };
  try {
    backend()?.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(next));
  } catch {
    /* armazenamento indisponível — segue apenas em memória */
  }
  emitSyncMetadata();
}

/** Atualiza parcialmente a metadata (sempre parte da leitura atual). */
export function updateSyncMetadata(patch: Partial<CloudSyncMetadata>): void {
  setSyncMetadata({ ...getSyncMetadata(), ...patch });
}

/** Volta a metadata ao padrão (usado em troca de conta e em testes). */
export function resetSyncMetadata(): void {
  setSyncMetadata(defaultSyncMetadata());
}

/**
 * Status a exibir: "Sincronizado" SÓ vale com nuvem ativa + revision conhecida
 * + zero pendência. Qualquer incoerência rebaixa para pendente.
 */
export function displaySyncStatus(meta: CloudSyncMetadata): SyncStatus {
  if (meta.status === "synced") {
    if (meta.mode !== "cloud" || meta.revision === null || meta.pendingPayload !== null) {
      return "pending";
    }
  }
  return meta.status;
}

/** Rótulo em português do status efetivo. */
export function syncStatusLabel(meta: CloudSyncMetadata): string {
  return SYNC_STATUS_LABEL[displaySyncStatus(meta)];
}

/** ETAPA 4L — rótulo curto do status efetivo (sidebar). */
export function syncStatusShortLabel(meta: CloudSyncMetadata): string {
  return SYNC_STATUS_SHORT_LABEL[displaySyncStatus(meta)];
}

/**
 * ETAPA 4L — a terceira via do cenário de dados legados ("Começar esta conta
 * sem esses dados") só pode ser oferecida quando REALMENTE há dados legados a
 * descartar e a conta ainda não tem nuvem própria. Com o dispositivo vazio o
 * cenário A já ativa a nuvem sozinho e a tela nem aparece; com nuvem ativa,
 * descartar seria destruir dados já vinculados.
 *
 * Predicado puro (e por isso testável) para não repetir a condição na UI.
 */
export function shouldOfferStartFresh(opts: { localEmpty: boolean; mode: SyncMode }): boolean {
  return !opts.localEmpty && opts.mode !== "cloud";
}

/**
 * ETAPA 4L — texto dinâmico do cartão "Dados e sincronização".
 * Em modo local (sem nuvem ativa) a frase é sempre a do dispositivo isolado.
 */
export function syncExplainText(meta: CloudSyncMetadata | null | undefined): string {
  if (!meta || meta.mode !== "cloud") return SYNC_EXPLAIN["not-started"];
  return SYNC_EXPLAIN[displaySyncStatus(meta)];
}

/* ─────────────────────────────────────────────────────────────
   Compartimentos por conta: ao trocar de login neste navegador, o slot da
   conta anterior (metadata + cópia do cache) é guardado sob a chave dela e
   restaurado quando ela voltar — sem nunca exibir a outra conta.
   ───────────────────────────────────────────────────────────── */

function stashKey(userId: string): string {
  return `${CLOUD_SYNC_STASH_PREFIX}${userId}`;
}

/** Guarda o slot de uma conta (metadata + cópia do cache operacional). */
export function stashAccountSlot(userId: string, meta: CloudSyncMetadata, cacheRaw: string | null): void {
  if (!userId) return;
  const stash: AccountStash = { meta, cacheRaw, savedAt: nowIso() };
  try {
    backend()?.setItem(stashKey(userId), JSON.stringify(stash));
  } catch {
    /* armazenamento indisponível — segue sem compartimento */
  }
}

/** Lê o compartimento guardado de uma conta (null = nenhum). */
export function readAccountStash(userId: string): AccountStash | null {
  if (!userId) return null;
  try {
    const raw = backend()?.getItem(stashKey(userId)) ?? null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountStash>;
    if (!parsed || !isValidMetadata(parsed.meta)) return null;
    if (parsed.cacheRaw !== null && typeof parsed.cacheRaw !== "string") return null;
    return { meta: parsed.meta, cacheRaw: parsed.cacheRaw, savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "" };
  } catch {
    return null;
  }
}

/** Remove o compartimento de uma conta (após restauração). */
export function clearAccountStash(userId: string): void {
  if (!userId) return;
  try {
    backend()?.removeItem(stashKey(userId));
  } catch {
    /* nada a fazer */
  }
}

/* ─────────────────────────────────────────────────────────────
   Ligação React (a metadata é reativa; o backend continua soberano).
   O snapshot é referencialmente estável enquanto o texto persistido não
   muda — exigência do `useSyncExternalStore`.
   ───────────────────────────────────────────────────────────── */

let snapshotRaw: string | null | undefined;
let snapshotMeta: CloudSyncMetadata | null = null;

function getSyncMetadataSnapshot(): CloudSyncMetadata {
  let raw: string | null = null;
  try {
    raw = backend()?.getItem(CLOUD_SYNC_META_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (snapshotMeta && raw === snapshotRaw) return snapshotMeta;
  snapshotRaw = raw;
  snapshotMeta = getSyncMetadata();
  return snapshotMeta;
}

export function useSyncMetadata(): CloudSyncMetadata {
  return useSyncExternalStore(
    subscribeSyncMetadata,
    getSyncMetadataSnapshot,
    getSyncMetadataSnapshot,
  );
}
