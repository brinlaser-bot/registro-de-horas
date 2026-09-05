/**
 * ETAPA 4K — Motor de sincronização multi-dispositivo (sem tempo real).
 *
 * Princípios (a ordem das proteções importa mais que a conveniência):
 *
 * 1. NADA é enviado sem ação explícita; nenhum row é criado sozinho.
 * 2. Erro de rede NUNCA vira "sem dados na nuvem".
 * 3. Toda escrita em nuvem ativa usa compare-and-swap por revision (+1 exato);
 *    CAS que não toca row algum vira conflito — jamais sobrescrita silenciosa.
 * 4. Conflito preserva os dois lados; a única saída é backup local ou adotar a
 *    nuvem por ação explícita confirmada (sem "forçar este dispositivo").
 * 5. Troca de conta neste navegador NUNCA exibe o cache da conta anterior.
 * 6. Atualização entre dispositivos chega ao abrir / focar / revisitar a aba
 *    (sem sondagem contínua, sem canal de tempo real).
 *
 * O motor transporta o estado canônico; NUNCA recalcula regra de negócio.
 */
import {
  applyCanonicalAppState,
  canonicalFingerprint,
  isEmptyOperationalState,
  serializeCanonicalAppState,
  validateCanonicalAppState,
  type CanonicalCloudPayload,
} from "./canonical";
import {
  clearAccountStash,
  getSyncMetadata,
  readAccountStash,
  resetSyncMetadata,
  setSyncMetadata,
  stashAccountSlot,
  updateSyncMetadata,
  type AccountStash,
} from "./metadata";
import {
  createInitialCloudState,
  fetchCloudState,
  saveCloudStateCAS,
  type CloudDataClient,
  type CloudRow,
} from "./client";
import { actions, getAppData, parseStoredAppData, readRawAppCache, subscribeToAppData } from "../store";
import { createEmptyState } from "../seed-data";
import type { ParsedBackup } from "../backup";

/* ─────────────────────────────────────────────────────────────
   Mensagens em português, sem jargão técnico para o usuário final.
   ───────────────────────────────────────────────────────────── */

export const MSG_LOADING_DATA = "Carregando seus dados…";
export const MSG_CLOUD_INVALID =
  "Os dados da nuvem não puderam ser validados. Seus dados deste dispositivo foram preservados.";
export const MSG_FETCH_FAILED =
  "Não foi possível falar com a nuvem agora. Seus dados deste dispositivo foram preservados.";
export const MSG_CONFLICT_TITLE = "Há alterações neste dispositivo e em outro dispositivo.";
export const MSG_CONFLICT_EXPLAIN =
  "Para evitar perda de informações, o Meu Horário não substituiu nenhuma das versões automaticamente.";
export const MSG_COLLISION_TITLE = "Encontramos dados neste dispositivo e também na nuvem.";
export const MSG_ACTIVATE_TITLE = "Seus dados ainda estão somente neste dispositivo.";
export const MSG_ACTIVATE_EXPLAIN =
  "Eles serão enviados para sua conta e poderão ser acessados nos outros dispositivos.";
export const MSG_ACTIVATE_CTA = "Usar estes dados na minha conta";
export const MSG_BACKUP_CTA = "Baixar backup de segurança";

/* ── ETAPA 4L — dados legados encontrados no dispositivo (cenário B) ── */

export const MSG_LEGACY_TITLE = "Encontramos dados neste dispositivo.";
export const MSG_LEGACY_EXPLAIN =
  "Você pode vinculá-los à sua conta para acessar em outros dispositivos.";
export const MSG_LEGACY_LINK_CTA = "Vincular estes dados à minha conta";
export const MSG_LEGACY_DISCARD_CTA = "Começar esta conta sem esses dados";
export const MSG_BACKUP_JSON_CTA = "Baixar backup (JSON)";
export const MSG_BACKUP_DEVICE_CTA = "Baixar backup deste dispositivo";
export const MSG_USE_CLOUD_CTA = "Usar versão da nuvem";
export const MSG_BLOCKED_TITLE = "Este navegador possui dados de outra conta";
export const MSG_BLOCKED_EXPLAIN =
  "Por segurança, os dados guardados aqui não são exibidos para esta conta. Saia e entre com a conta correspondente para continuar.";
export const MSG_CLOUD_ROW_MISSING =
  "Os dados da nuvem desta conta não foram encontrados. Nada foi alterado neste dispositivo.";

/* ─────────────────────────────────────────────────────────────
   Sessão do motor (conta autenticada + client) e travas internas.
   ───────────────────────────────────────────────────────────── */

interface EngineSession {
  db: CloudDataClient;
  userId: string;
}

let session: EngineSession | null = null;
/** `true` enquanto o motor aplica estado remoto (não é mutação do usuário). */
let applyingRemote = false;
/** `true` enquanto um envio CAS está em voo (sem concorrência de escrita). */
let syncInFlight = false;

/** Vincula o motor à conta autenticada atual. */
export function configureCloudSync(db: CloudDataClient, userId: string): void {
  session = { db, userId };
}

/** Zera o estado interno do motor (testes). A metadata persistida não é tocada. */
export function resetCloudSyncEngineForTests(): void {
  session = null;
  applyingRemote = false;
  syncInFlight = false;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Cópia textual do cache operacional para o compartimento da conta. Usa o
 * texto persistido quando existe; fora do navegador (SSR/testes) serializa o
 * estado em memória — o slot NUNCA pode ficar vazio, sob pena de a conta que
 * volta reencontrar o ambiente da outra.
 */
function currentCacheSnapshot(): string | null {
  const raw = readRawAppCache();
  if (raw) return raw;
  try {
    return JSON.stringify(getAppData());
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Fases do portão de inicialização (decididas antes de renderizar).
   ───────────────────────────────────────────────────────────── */

/** `loading` existe só no React; o motor sempre devolve uma decisão final. */
export type BootstrapPhase = "loading" | "ready" | "blocked-other-account" | "collision";

export interface BootstrapResult {
  phase: Exclude<BootstrapPhase, "loading">;
}

/**
 * Inicialização: resolve a conta autenticada contra o cache local e a nuvem
 * ANTES de qualquer conteúdo operacional ser exibido.
 */
export async function bootstrapCloudSync(
  db: CloudDataClient,
  userId: string,
): Promise<BootstrapResult> {
  session = { db, userId };
  let meta = getSyncMetadata();

  // Compartimento da própria conta (volta após outra conta ter usado o navegador).
  if (!meta.activeUserId || meta.activeUserId === userId) {
    const own = readAccountStash(userId);
    if (own) {
      restoreAccountStash(userId, own);
      meta = getSyncMetadata();
    }
  }

  // ── Troca de conta: este navegador tem vínculo com OUTRA conta ──
  if (meta.activeUserId && meta.activeUserId !== userId) {
    stashAccountSlot(meta.activeUserId, meta, currentCacheSnapshot());
    const incoming = readAccountStash(userId);
    if (incoming) {
      restoreAccountStash(userId, incoming);
      meta = getSyncMetadata();
    } else {
      const previousMode = meta.mode;
      resetSyncMetadata();
      const remote = await fetchCloudState(db, userId);
      if (remote.status === "valid") {
        // Conta nova com nuvem: adota a nuvem dela direto (o slot anterior
        // está guardado; nenhum dado alheio é exibido ou comparado).
        applyRemoteRow(remote.row, remote.parsed);
        return { phase: "ready" };
      }
      if (remote.status === "invalid") {
        updateSyncMetadata({ status: "error", lastError: MSG_CLOUD_INVALID });
        return { phase: "blocked-other-account" };
      }
      if (remote.status === "error") {
        updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED });
        return { phase: "blocked-other-account" };
      }
      // ETAPA 4L (CENÁRIO D) — a conta anterior tinha os dados VINCULADOS à
      // nuvem dela (slot guardado e recuperável): a conta que chega começa em
      // um ambiente vazio e isolado, jamais herdando o conteúdo alheio.
      // Quando os dados da conta anterior NUNCA foram enviados, a propriedade
      // é ambígua e a tela segura continua valendo.
      if (previousMode === "cloud") {
        applyEmptyIsolatedState();
        updateSyncMetadata({ status: "not-started", lastError: null });
        return activateCloudSync();
      }
      updateSyncMetadata({ status: "not-started", lastError: null });
      return { phase: "blocked-other-account" };
    }
  }

  // ── Mesma conta (ou slot livre): decide contra a nuvem ──
  meta = getSyncMetadata();
  const remote = await fetchCloudState(db, userId);

  if (remote.status === "error") {
    updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED });
    return { phase: "ready" };
  }
  if (remote.status === "invalid") {
    updateSyncMetadata({ status: "error", lastError: MSG_CLOUD_INVALID });
    return { phase: "ready" };
  }
  if (remote.status === "not_found") {
    if (meta.mode === "cloud") {
      // O row sumiu do servidor: erro seguro, jamais recriação silenciosa.
      updateSyncMetadata({ status: "error", lastError: MSG_CLOUD_ROW_MISSING });
      return { phase: "ready" };
    }
    // Slot local: vincula a conta quando há conteúdo a proteger.
    const local = getAppData();
    if (!isEmptyOperationalState(local) && !meta.activeUserId) {
      updateSyncMetadata({ activeUserId: userId });
    }
    updateSyncMetadata({ status: "not-started", lastError: null });
    // ETAPA 4L (CENÁRIO A) — conta autenticada SEM estado na nuvem e
    // dispositivo comprovadamente vazio, sem vínculo anterior: nada de
    // usuário a arriscar, o estado inicial é criado automaticamente
    // (revision 1) pelo MESMO caminho de ativação — sem botão.
    if (isEmptyOperationalState(local) && !meta.activeUserId) {
      return activateCloudSync();
    }
    // ETAPA 4L (CENÁRIO B) — há dados locais relevantes ainda não vinculados:
    // NUNCA enviar sozinho; a decisão fica com o usuário em Configurações.
    return { phase: "ready" };
  }

  // ── Nuvem válida ──
  const row = remote.row;
  const local = getAppData();

  if (meta.mode === "cloud" && meta.activeUserId === userId) {
    if (meta.pendingPayload !== null && meta.pendingBaseRevision !== null) {
      // Pendência de outra sessão: mantém tudo e retoma o envio em seguida.
      updateSyncMetadata({ status: "pending", cloudRevision: row.revision, lastError: null });
      void attemptSync();
      return { phase: "ready" };
    }
    if (meta.revision !== null && row.revision > meta.revision) {
      applyRemoteRow(row, remote.parsed);
      return { phase: "ready" };
    }
    if (meta.revision !== null && row.revision === meta.revision) {
      const fingerprintLocal = canonicalFingerprint(serializeCanonicalAppState(local));
      if (
        fingerprintLocal === meta.lastSyncedFingerprint ||
        fingerprintLocal === canonicalFingerprint(row.payload)
      ) {
        updateSyncMetadata({ status: "synced", cloudRevision: row.revision, lastError: null });
      } else {
        // Local divergiu sem pendência registrada: vira mutação CAS normal.
        queuePendingFromLocal(meta.revision);
        void attemptSync();
      }
      return { phase: "ready" };
    }
    // Revision desconhecida ou remota atrás da local: estado seguro, sem chute.
    updateSyncMetadata({ status: "error", cloudRevision: row.revision, lastError: MSG_FETCH_FAILED });
    return { phase: "ready" };
  }

  // ── Slot sem vínculo cloud: dispositivo limpo, idêntico ou colisão ──
  if (isEmptyOperationalState(local)) {
    applyRemoteRow(row, remote.parsed);
    return { phase: "ready" };
  }
  if (canonicalFingerprint(serializeCanonicalAppState(local)) === canonicalFingerprint(row.payload)) {
    // Conteúdo idêntico: adota a revision sem tocar no cache.
    updateSyncMetadata({
      mode: "cloud",
      activeUserId: userId,
      revision: row.revision,
      cloudRevision: row.revision,
      status: "synced",
      pendingPayload: null,
      pendingBaseRevision: null,
      lastSyncedFingerprint: canonicalFingerprint(row.payload),
      lastSyncedAt: nowIso(),
      lastError: null,
    });
    return { phase: "ready" };
  }
  // Colisão de inicialização: preserva ambos, decide só por ação explícita.
  updateSyncMetadata({
    status: "conflict",
    cloudRevision: row.revision,
    activeUserId: userId,
    lastError: MSG_COLLISION_TITLE,
  });
  return { phase: "collision" };
}

/* ─────────────────────────────────────────────────────────────
   Aplicação de estado remoto (substitui o cache; nunca é mutação).
   ───────────────────────────────────────────────────────────── */

function applyRemoteRow(row: CloudRow, parsed: ParsedBackup): void {
  const userId = session?.userId ?? null;
  applyingRemote = true;
  try {
    applyCanonicalAppState(parsed);
  } finally {
    applyingRemote = false;
  }
  updateSyncMetadata({
    mode: "cloud",
    activeUserId: userId,
    revision: row.revision,
    cloudRevision: row.revision,
    status: "synced",
    pendingPayload: null,
    pendingBaseRevision: null,
    lastSyncedFingerprint: canonicalFingerprint(row.payload),
    lastSyncedAt: nowIso(),
    lastError: null,
  });
}

function restoreAccountStash(userId: string, stash: AccountStash): void {
  if (stash.cacheRaw) {
    const parsed = parseStoredAppData(stash.cacheRaw);
    if (parsed) {
      applyingRemote = true;
      try {
        actions.replaceAll({
          user: parsed.user,
          entries: parsed.entries,
          compensations: parsed.compensations,
          absences: parsed.absences,
          companyCalendars: parsed.companyCalendars,
          faltas: parsed.faltas,
          excessReasons: parsed.excessReasons,
          specialExcessUses: parsed.specialExcessUses,
          specialExcessPlans: parsed.specialExcessPlans,
          periodConsolidations: parsed.periodConsolidations,
          annualCycleClosures: parsed.annualCycleClosures,
        });
      } finally {
        applyingRemote = false;
      }
    }
  }
  setSyncMetadata({ ...stash.meta, activeUserId: userId });
  clearAccountStash(userId);
}

/**
 * ETAPA 4L — zera o cache operacional deste navegador para um ambiente NOVO e
 * isolado (nenhum dado de outra conta permanece visível). Não é mutação do
 * usuário: o motor marca a aplicação como remota.
 */
function applyEmptyIsolatedState(): void {
  applyingRemote = true;
  try {
    actions.replaceAll(createEmptyState());
  } finally {
    applyingRemote = false;
  }
}

/**
 * ETAPA 4L (CENÁRIO B — ação explícita) — "Começar esta conta sem esses
 * dados": descarta o conteúdo legado NÃO VINCULADO deste dispositivo e cria o
 * estado inicial da conta. Só é oferecido quando a conta ainda não tem nuvem.
 */
export function startFreshForAccount(): Promise<BootstrapResult> {
  const current = session;
  if (!current) return Promise.resolve({ phase: "ready" });
  const meta = getSyncMetadata();
  if (meta.mode === "cloud") return Promise.resolve({ phase: "ready" });
  applyEmptyIsolatedState();
  updateSyncMetadata({ activeUserId: null, status: "not-started", lastError: null });
  return activateCloudSync();
}

/* ─────────────────────────────────────────────────────────────
   Mutações locais em nuvem ativa: aplica na hora, envia via CAS.
   ───────────────────────────────────────────────────────────── */

/** Registra o snapshot atual como pendente sobre a base informada. */
function queuePendingFromLocal(baseRevision: number): CanonicalCloudPayload | null {
  const snapshot = serializeCanonicalAppState(getAppData());
  if (!validateCanonicalAppState(snapshot).ok) {
    updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED });
    return null;
  }
  updateSyncMetadata({
    pendingPayload: snapshot,
    pendingBaseRevision: baseRevision,
    status: "pending",
    lastError: null,
  });
  return snapshot;
}

/**
 * Avina ao motor que o store operacional mudou. Em nuvem ativa, o snapshot
 * canônico vira pendência (mantendo a MESMA base até o sucesso) e o envio é
 * tentado. Em conflito, a pendência é atualizada sem tentar enviar sozinho.
 */
export function noteLocalMutation(): Promise<void> {
  const current = session;
  if (!current) return Promise.resolve();
  if (applyingRemote) return Promise.resolve();
  const meta = getSyncMetadata();
  if (meta.mode !== "cloud") return Promise.resolve();
  if (meta.activeUserId && meta.activeUserId !== current.userId) return Promise.resolve();

  const snapshot = serializeCanonicalAppState(getAppData());
  if (!validateCanonicalAppState(snapshot).ok) {
    updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED });
    return Promise.resolve();
  }
  const fingerprint = canonicalFingerprint(snapshot);

  if (meta.status === "conflict") {
    // Conflito: atualiza o snapshot guardado; nenhum envio automático.
    updateSyncMetadata({ pendingPayload: snapshot, lastError: MSG_CONFLICT_TITLE });
    return Promise.resolve();
  }

  const base = meta.pendingBaseRevision ?? meta.revision;
  if (base === null || base === undefined) {
    updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED, pendingPayload: snapshot });
    return Promise.resolve();
  }
  if (meta.pendingPayload === null && fingerprint === meta.lastSyncedFingerprint) {
    return Promise.resolve();
  }
  if (meta.pendingPayload !== null && canonicalFingerprint(meta.pendingPayload) === fingerprint) {
    return attemptSync();
  }
  updateSyncMetadata({
    pendingPayload: snapshot,
    pendingBaseRevision: base,
    status: "pending",
    lastError: null,
  });
  return attemptSync();
}

/**
 * Envia a pendência via CAS, drenando snapshots que cheguem durante o voo
 * (a base avança somente sobre sucesso confirmado; conflito/erro param).
 */
async function attemptSync(): Promise<void> {
  if (syncInFlight) return;
  const current = session;
  if (!current) return;
  syncInFlight = true;
  try {
    for (;;) {
      const meta = getSyncMetadata();
      if (meta.mode !== "cloud") return;
      if (meta.activeUserId && meta.activeUserId !== current.userId) return;
      if (meta.status === "conflict") return;
      const payload = meta.pendingPayload;
      const base = meta.pendingBaseRevision;
      if (payload === null || base === null || base === undefined) return;

      updateSyncMetadata({ status: "syncing", lastError: null });
      const sentFingerprint = canonicalFingerprint(payload);
      const result = await saveCloudStateCAS(current.db, current.userId, payload, base);

      if (result.status === "saved") {
        const after = getSyncMetadata();
        const unchanged =
          after.pendingPayload !== null &&
          after.pendingBaseRevision === base &&
          canonicalFingerprint(after.pendingPayload) === sentFingerprint;
        if (unchanged) {
          updateSyncMetadata({
            status: "synced",
            revision: result.revision,
            cloudRevision: result.revision,
            pendingPayload: null,
            pendingBaseRevision: null,
            lastSyncedFingerprint: sentFingerprint,
            lastSyncedAt: nowIso(),
            lastError: null,
          });
          return;
        }
        // Novo snapshot chegou durante o voo: avança a base e envia o mais novo.
        updateSyncMetadata({
          revision: result.revision,
          cloudRevision: result.revision,
          pendingBaseRevision: result.revision,
          lastSyncedFingerprint: sentFingerprint,
          lastSyncedAt: nowIso(),
        });
        continue;
      }

      if (result.status === "conflict") {
        const remote = result.remote;
        if (remote && canonicalFingerprint(remote.payload) === sentFingerprint) {
          // Falso conflito: outro dispositivo gravou o conteúdo idêntico —
          // adota a revision remota, limpa a pendência, sem alarde.
          updateSyncMetadata({
            status: "synced",
            revision: remote.revision,
            cloudRevision: remote.revision,
            pendingPayload: null,
            pendingBaseRevision: null,
            lastSyncedFingerprint: sentFingerprint,
            lastSyncedAt: nowIso(),
            lastError: null,
          });
          return;
        }
        updateSyncMetadata({
          status: "conflict",
          cloudRevision: remote ? remote.revision : null,
          lastError: MSG_CONFLICT_TITLE,
        });
        return;
      }

      // Falha de rede/API: a mutação local continua valendo; tenta depois.
      updateSyncMetadata({ status: "pending", lastError: null });
      return;
    }
  } finally {
    syncInFlight = false;
  }
}

/* ─────────────────────────────────────────────────────────────
   Retentativa, atualização por foco, ativação e resolução.
   ───────────────────────────────────────────────────────────── */

/**
 * Retentativa manual (ou ao voltar a conexão): com pendência em nuvem ativa,
 * tenta o envio; nos demais casos, re-resolve a situação por completo.
 */
export function retryPendingSync(): Promise<BootstrapResult> {
  const current = session;
  if (!current) return Promise.resolve({ phase: "ready" });
  const meta = getSyncMetadata();
  if (meta.mode === "cloud" && meta.pendingPayload !== null && meta.status !== "conflict") {
    return attemptSync().then(() => ({ phase: "ready" as const }));
  }
  return bootstrapCloudSync(current.db, current.userId);
}

/**
 * Atualização ao abrir/focar/revisitar: sem pendência e sem conflito, baixa o
 * remoto quando ele estiver à frente. Nunca toca em pendência local.
 */
export function refreshOnFocus(): Promise<BootstrapResult | null> {
  const current = session;
  if (!current) return Promise.resolve(null);
  if (syncInFlight) return Promise.resolve(null);
  const meta = getSyncMetadata();
  if (meta.activeUserId && meta.activeUserId !== current.userId) return Promise.resolve(null);

  if (meta.mode !== "cloud") {
    // Slot ainda não iniciado: o row pode ter surgido em outro dispositivo.
    if (meta.status === "not-started") return bootstrapCloudSync(current.db, current.userId);
    return Promise.resolve(null);
  }
  if (meta.pendingPayload !== null || meta.status === "conflict") return Promise.resolve(null);
  if (meta.revision === null || meta.revision === undefined) {
    return bootstrapCloudSync(current.db, current.userId);
  }
  return (async (): Promise<BootstrapResult | null> => {
    const remote = await fetchCloudState(current.db, current.userId);
    if (remote.status !== "valid") return null;
    if (remote.row.revision > (meta.revision as number)) {
      applyRemoteRow(remote.row, remote.parsed);
      return null;
    }
    if (remote.row.revision === meta.revision) {
      const fingerprintLocal = canonicalFingerprint(serializeCanonicalAppState(getAppData()));
      if (
        fingerprintLocal !== meta.lastSyncedFingerprint &&
        fingerprintLocal !== canonicalFingerprint(remote.row.payload)
      ) {
        queuePendingFromLocal(meta.revision as number);
        void attemptSync();
      }
    }
    return null;
  })();
}

/**
 * Primeira ativação (AÇÃO EXPLÍCITA do botão): serializa + valida o estado
 * local e cria o row (revision 1). Se o row já existir, re-resolve com
 * segurança em vez de sobrescrever.
 */
export function activateCloudSync(): Promise<BootstrapResult> {
  const current = session;
  if (!current) return Promise.resolve({ phase: "ready" });
  const meta = getSyncMetadata();
  if (meta.activeUserId && meta.activeUserId !== current.userId) {
    return Promise.resolve({ phase: "blocked-other-account" });
  }
  const snapshot = serializeCanonicalAppState(getAppData());
  if (!validateCanonicalAppState(snapshot).ok) {
    updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED });
    return Promise.resolve({ phase: "ready" });
  }
  updateSyncMetadata({ status: "syncing", lastError: null });
  return (async (): Promise<BootstrapResult> => {
    const result = await createInitialCloudState(current.db, current.userId, snapshot);
    if (result.status === "created") {
      updateSyncMetadata({
        mode: "cloud",
        activeUserId: current.userId,
        revision: 1,
        cloudRevision: 1,
        status: "synced",
        pendingPayload: null,
        pendingBaseRevision: null,
        lastSyncedFingerprint: canonicalFingerprint(snapshot),
        lastSyncedAt: nowIso(),
        lastError: null,
      });
      return { phase: "ready" };
    }
    if (result.status === "exists") {
      return bootstrapCloudSync(current.db, current.userId);
    }
    updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED });
    return { phase: "ready" };
  })();
}

/**
 * "Usar versão da nuvem" (AÇÃO EXPLÍCITA confirmada na UI): substitui o cache
 * local pelo remoto validado. Falha mantém tudo como está.
 */
export function resolveUseCloudVersion(): Promise<BootstrapResult> {
  const current = session;
  if (!current) return Promise.resolve({ phase: "ready" });
  updateSyncMetadata({ status: "syncing", lastError: null });
  return (async (): Promise<BootstrapResult> => {
    const remote = await fetchCloudState(current.db, current.userId);
    if (remote.status === "valid") {
      applyRemoteRow(remote.row, remote.parsed);
      return { phase: "ready" };
    }
    if (remote.status === "invalid") {
      updateSyncMetadata({ status: "error", lastError: MSG_CLOUD_INVALID });
    } else {
      updateSyncMetadata({ status: "error", lastError: MSG_FETCH_FAILED });
    }
    const meta = getSyncMetadata();
    return { phase: meta.mode === "cloud" ? "ready" : "collision" };
  })();
}

/* ─────────────────────────────────────────────────────────────
   Vigilância: assinatura do store + foco/visibilidade/conexão.
   Sem sondagem contínua e sem canal de tempo real.
   ───────────────────────────────────────────────────────────── */

/**
 * Liga o motor ao store e aos gatilhos de atualização. Devolve a função que
 * desliga tudo. Fora do navegador, devolve um desligamento vazio.
 */
export function startCloudSyncWatch(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }
  const unsubscribeStore = subscribeToAppData(() => {
    void noteLocalMutation();
  });
  const onFocus = (): void => {
    void refreshOnFocus();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") void refreshOnFocus();
  };
  const onOnline = (): void => {
    void retryPendingSync();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  return () => {
    unsubscribeStore();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
  };
}
