"use client";

/**
 * ETAPA 4K — Provedor e portão da sincronização multi-dispositivo.
 *
 * O provedor resolve a conta autenticada contra o cache local e a nuvem ANTES
 * de exibir qualquer conteúdo operacional (sem flash de dados alheios) e liga
 * o motor aos gatilhos de atualização (mutações, foco, visibilidade, conexão).
 *
 * O portão (`CloudSyncGate`) decide o que renderizar:
 *   - `loading` → "Carregando seus dados…";
 *   - `blocked-other-account` → tela segura (nunca exibe o cache alheio);
 *   - `collision` → nuvem + legado local, decisão por ação explícita;
 *   - `ready` → o app, com faixa discreta apenas durante conflito real.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AlertTriangle, CloudOff, Download, RefreshCw } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getAuthenticatedUserEmail, getAuthenticatedUserId, getSyncClient } from "@/lib/cloud-sync/client";
import {
  activateCloudSync,
  bootstrapCloudSync,
  MSG_ACTIVATE_EXPLAIN,
  MSG_ACTIVATE_TITLE,
  MSG_BACKUP_CTA,
  MSG_BLOCKED_EXPLAIN,
  MSG_BLOCKED_TITLE,
  MSG_COLLISION_TITLE,
  MSG_CONFLICT_EXPLAIN,
  MSG_CONFLICT_TITLE,
  MSG_LOADING_DATA,
  MSG_USE_CLOUD_CTA,
  resolveUseCloudVersion,
  retryPendingSync,
  startCloudSyncWatch,
  startFreshForAccount,
  type BootstrapPhase,
} from "@/lib/cloud-sync/engine";
import {
  displaySyncStatus,
  useSyncMetadata,
  type CloudSyncMetadata,
  type SyncStatus,
} from "@/lib/cloud-sync/metadata";
import { downloadLocalBackup } from "@/lib/cloud-sync/canonical";
import { Button, Spinner } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out-button";

interface CloudSyncContextValue {
  phase: BootstrapPhase;
  userId: string | null;
  /** ETAPA 4L — e-mail da conta autenticada (nunca o user_id). */
  email: string | null;
  meta: CloudSyncMetadata;
  status: SyncStatus;
  retry: () => Promise<void>;
  activate: () => Promise<void>;
  useCloud: () => Promise<void>;
  /** ETAPA 4L — descarta dados legados não vinculados e inicia a conta. */
  startFresh: () => Promise<void>;
}

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);

/** Contexto da sincronização (null fora do provedor). */
export function useCloudSyncOptional(): CloudSyncContextValue | null {
  return useContext(CloudSyncContext);
}

async function initializeCloudSync(
  setUserId: (id: string | null) => void,
  setEmail: (email: string | null) => void,
  setPhase: (phase: BootstrapPhase) => void,
): Promise<(() => void) | null> {
  if (!isSupabaseConfigured()) {
    setPhase("ready");
    return null;
  }
  let db;
  try {
    db = getSyncClient();
  } catch {
    setPhase("ready");
    return null;
  }
  const userId = await getAuthenticatedUserId(db);
  if (!userId) {
    // Sem sessão: a proteção de rotas redireciona; nada a resolver aqui.
    setPhase("ready");
    return null;
  }
  setUserId(userId);
  setEmail(await getAuthenticatedUserEmail(db));
  const result = await bootstrapCloudSync(db, userId);
  setPhase(result.phase);
  return startCloudSyncWatch();
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<BootstrapPhase>("loading");
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const meta = useSyncMetadata();

  useEffect(() => {
    let active = true;
    let stop: (() => void) | null = null;
    const guardedSetPhase = (next: BootstrapPhase) => {
      if (active) setPhase(next);
    };
    const guardedSetUserId = (id: string | null) => {
      if (active) setUserId(id);
    };
    const guardedSetEmail = (value: string | null) => {
      if (active) setEmail(value);
    };
    void initializeCloudSync(guardedSetUserId, guardedSetEmail, guardedSetPhase).then((stopWatch) => {
      stop = stopWatch;
      if (!active && stop) stop();
    });
    return () => {
      active = false;
      if (stop) stop();
    };
  }, []);

  const retry = useCallback(async () => {
    const result = await retryPendingSync();
    setPhase(result.phase);
  }, []);

  const activate = useCallback(async () => {
    const result = await activateCloudSync();
    setPhase(result.phase);
  }, []);

  const useCloud = useCallback(async () => {
    const result = await resolveUseCloudVersion();
    setPhase(result.phase);
  }, []);

  const startFresh = useCallback(async () => {
    const result = await startFreshForAccount();
    setPhase(result.phase);
  }, []);

  const value = useMemo<CloudSyncContextValue>(
    () => ({
      phase,
      userId,
      email,
      meta,
      status: displaySyncStatus(meta),
      retry,
      activate,
      useCloud,
      startFresh,
    }),
    [phase, userId, email, meta, retry, activate, useCloud, startFresh],
  );

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

/* ─────────────────────────────────────────────────────────────
   Portão de renderização.
   ───────────────────────────────────────────────────────────── */

function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function LoadingGate() {
  return (
    <GateShell>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <Spinner className="mx-auto" />
        <p className="mt-3 text-sm font-bold text-slate-700">{MSG_LOADING_DATA}</p>
      </div>
    </GateShell>
  );
}

function BlockedGate() {
  return (
    <GateShell>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <CloudOff size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900">{MSG_BLOCKED_TITLE}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{MSG_BLOCKED_EXPLAIN}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <SignOutButton className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700" />
        </div>
      </div>
    </GateShell>
  );
}

function CollisionGate({
  onUseCloud,
  email,
}: {
  onUseCloud: () => Promise<void>;
  email: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleUseCloud = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onUseCloud();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <GateShell>
      <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900">{MSG_COLLISION_TITLE}</p>
            {email && (
              <p className="mt-1 truncate text-xs font-semibold text-slate-600">
                Conta conectada: {email}
              </p>
            )}
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Para evitar perda de informações, o Meu Horário não substituiu nenhuma das versões
              automaticamente. Guarde uma cópia deste dispositivo antes de decidir.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <Button variant="secondary" size="sm" onClick={downloadLocalBackup}>
            <Download size={14} /> {MSG_BACKUP_CTA}
          </Button>
          {!confirming ? (
            <Button size="sm" onClick={() => setConfirming(true)}>
              {MSG_USE_CLOUD_CTA}
            </Button>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-900">
                Substituir o conteúdo deste dispositivo pela versão da nuvem?
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  Voltar
                </Button>
                <Button size="sm" onClick={handleUseCloud} disabled={busy}>
                  {busy ? "Aplicando…" : "Confirmar"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </GateShell>
  );
}

function ConflictBanner({ email }: { email: string | null }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5 font-bold text-amber-900">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="truncate">{MSG_CONFLICT_TITLE}</span>
        </span>
        <span className="hidden text-amber-700 sm:inline">{MSG_CONFLICT_EXPLAIN}</span>
        {email && (
          <span className="hidden min-w-0 truncate text-amber-700 md:inline">
            Conta conectada: {email}
          </span>
        )}
        <Link
          href="/configuracoes"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-900/90 px-2.5 py-1 font-bold text-white hover:bg-amber-900"
        >
          <RefreshCw size={12} /> Resolver
        </Link>
      </div>
    </div>
  );
}

export function CloudSyncGate({ children }: { children: ReactNode }) {
  const ctx = useCloudSyncOptional();
  if (!ctx) return <>{children}</>;
  if (ctx.phase === "loading") return <LoadingGate />;
  if (ctx.phase === "blocked-other-account") return <BlockedGate />;
  if (ctx.phase === "collision") return <CollisionGate onUseCloud={ctx.useCloud} email={ctx.email} />;
  return (
    <>
      {ctx.status === "conflict" && <ConflictBanner email={ctx.email} />}
      {children}
    </>
  );
}

/** Título/ajuda da primeira ativação (reutilizado em Configurações). */
export function CloudSyncActivationCopy() {
  return (
    <div className="min-w-0">
      <p className="text-sm font-extrabold text-slate-900">{MSG_ACTIVATE_TITLE}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{MSG_ACTIVATE_EXPLAIN}</p>
    </div>
  );
}
