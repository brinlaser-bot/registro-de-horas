"use client";

/**
 * ETAPA 4K/4L — Seção de sincronização dentro do cartão único
 * "Dados e sincronização" (Configurações).
 *
 * 4K: estado atual, primeira ativação, retentativa manual e resolução de
 * conflito (backup local + "Usar versão da nuvem" com confirmação). Nenhuma
 * ação automática parte daqui.
 *
 * 4L: a ativação automática de conta nova e vazia acontece no motor; aqui
 * resta apenas o caso de DADOS LEGADOS não vinculados, que exige confirmação
 * explícita, e a resolução de conflito com a conta conectada identificada.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, CloudOff, Download, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useAppData, useIsClient } from "@/lib/store";
import {
  downloadLocalBackup,
  isEmptyOperationalState,
} from "@/lib/cloud-sync/canonical";
import {
  MSG_ACTIVATE_CTA,
  MSG_BACKUP_CTA,
  MSG_BACKUP_JSON_CTA,
  MSG_CONFLICT_EXPLAIN,
  MSG_CONFLICT_TITLE,
  MSG_LEGACY_DISCARD_CTA,
  MSG_LEGACY_EXPLAIN,
  MSG_LEGACY_LINK_CTA,
  MSG_LEGACY_TITLE,
  MSG_USE_CLOUD_CTA,
} from "@/lib/cloud-sync/engine";
import {
  shouldOfferStartFresh,
  SYNC_STATUS_LABEL,
  type SyncStatus,
} from "@/lib/cloud-sync/metadata";
import { useCloudSyncOptional } from "./cloud-sync-provider";
import { Button } from "@/components/ui";

/**
 * ETAPA 4L — rótulos legados da 4K mantidos como referência do MESMO fluxo:
 * a vinculação continua sendo a ativação (`MSG_ACTIVATE_CTA`) e o backup
 * continua sendo o BACKUP v3 (`MSG_BACKUP_CTA`), agora exibidos com os textos
 * finais da v1.0 e com um único botão de backup no cartão.
 */
const LEGACY_LABELS = {
  activate: MSG_ACTIVATE_CTA,
  backup: MSG_BACKUP_CTA,
} as const;

const DOT: Record<SyncStatus, string> = {
  "not-started": "bg-slate-400",
  syncing: "bg-sky-500 animate-pulse",
  synced: "bg-emerald-500",
  pending: "bg-amber-500",
  conflict: "bg-red-500",
  error: "bg-red-500",
};

function StatusRow({ status, email }: { status: SyncStatus; email: string | null }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
      <p className="text-sm font-extrabold text-slate-900">{SYNC_STATUS_LABEL[status]}</p>
      {email && (
        <p className="min-w-0 break-all text-xs font-semibold text-slate-500">
          Conta conectada: {email}
        </p>
      )}
    </div>
  );
}

/**
 * ETAPA 4L — conexão do navegador (apenas VISUAL; nenhum PWA/service worker).
 * Sem rede, o estado local continua disponível e a informação exibida é
 * coerente: pendente quando há alterações a enviar, "Sem conexão" quando não.
 */
function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return offline;
}

function formatSyncedAt(iso: string | null): string | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function UseCloudConfirm({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <Button size="sm" onClick={() => setConfirming(true)}>
        {MSG_USE_CLOUD_CTA} desta conta
      </Button>
    );
  }
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="text-xs font-bold text-red-900">
        Substituir o conteúdo deste dispositivo pela versão da nuvem? Baixe o backup antes se ainda
        não guardou uma cópia.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
          Voltar
        </Button>
        <Button size="sm" onClick={handleConfirm} disabled={busy}>
          {busy ? "Aplicando…" : "Confirmar"}
        </Button>
      </div>
    </div>
  );
}

export function CloudSyncSettings() {
  const ctx = useCloudSyncOptional();
  const mounted = useIsClient();
  const appData = useAppData();
  const [busyAction, setBusyAction] = useState<"activate" | "retry" | "fresh" | null>(null);
  const offline = useIsOffline();

  if (!mounted || !ctx || !ctx.userId) return null;

  const { meta, status } = ctx;
  const localEmpty = isEmptyOperationalState(appData);
  const syncedAt = formatSyncedAt(meta.lastSyncedAt);

  const runActivate = async () => {
    if (busyAction) return;
    setBusyAction("activate");
    try {
      await ctx.activate();
    } finally {
      setBusyAction(null);
    }
  };

  const runRetry = async () => {
    if (busyAction) return;
    setBusyAction("retry");
    try {
      await ctx.retry();
    } finally {
      setBusyAction(null);
    }
  };

  /** 4L — "Começar esta conta sem esses dados" (só sem nuvem própria ainda). */
  const runStartFresh = async () => {
    if (busyAction) return;
    setBusyAction("fresh");
    try {
      await ctx.startFresh();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <div className="grid gap-3">
        <StatusRow status={status} email={ctx.email} />
        {offline && status !== "pending" && status !== "conflict" && (
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <CloudOff size={14} className="shrink-0 text-slate-400" /> Sem conexão
          </p>
        )}

        {status === "not-started" && (
          <div className="grid gap-3">
            {/* 4L (CENÁRIO B) — dados legados NÃO vinculados: confirmação única.
                Conta nova e vazia nem chega aqui (ativação automática). */}
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900">{MSG_LEGACY_TITLE}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{MSG_LEGACY_EXPLAIN}</p>
              {!localEmpty && (
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Antes de vincular, guarde uma cópia usando o botão de backup deste cartão.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={downloadLocalBackup}
                data-legacy-label={LEGACY_LABELS.backup}
              >
                <Download size={14} /> {MSG_BACKUP_JSON_CTA}
              </Button>
              <Button
                size="sm"
                onClick={runActivate}
                disabled={busyAction !== null}
                data-legacy-label={LEGACY_LABELS.activate}
              >
                {busyAction === "activate" ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Vinculando…
                  </>
                ) : (
                  MSG_LEGACY_LINK_CTA
                )}
              </Button>
              {/* 4L — a terceira via só faz sentido QUANDO HÁ dados legados a
                  descartar: com o dispositivo vazio o cenário A já ativou a
                  nuvem sozinho e esta tela sequer aparece. A ação é sempre
                  explícita (clique), nunca automática no bootstrap/login. */}
              {shouldOfferStartFresh({ localEmpty, mode: meta.mode }) && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={runStartFresh}
                  disabled={busyAction !== null}
                >
                  {busyAction === "fresh" ? "Preparando…" : MSG_LEGACY_DISCARD_CTA}
                </Button>
              )}
            </div>
          </div>
        )}

        {status === "syncing" && (
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Enviando suas alterações para a nuvem…
          </p>
        )}

        {status === "synced" && (
          <div className="grid gap-1">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={14} /> Seus dados estão atualizados nesta conta.
            </p>
            {syncedAt && (
              <p className="text-[11px] text-slate-400">Última sincronização: {syncedAt}</p>
            )}
          </div>
        )}

        {status === "pending" && (
          <div className="grid gap-2">
            <p className="text-xs leading-relaxed text-slate-500">
              Há alterações deste dispositivo ainda não enviadas. Elas estão guardadas aqui e serão
              enviadas automaticamente quando possível.
            </p>
            <div>
              <Button variant="secondary" size="sm" onClick={runRetry} disabled={busyAction !== null}>
                <RefreshCw size={14} />
                {busyAction === "retry" ? "Tentando…" : "Tentar novamente"}
              </Button>
            </div>
          </div>
        )}

        {status === "conflict" && (
          <div className="grid gap-2">
            <p className="text-sm font-extrabold text-slate-900">{MSG_CONFLICT_TITLE}</p>
            <p className="text-xs leading-relaxed text-slate-500">{MSG_CONFLICT_EXPLAIN}</p>
            {ctx.email && (
              <p className="break-all text-xs font-semibold text-slate-600">
                Conta conectada: {ctx.email}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={downloadLocalBackup}>
                <Download size={14} /> {MSG_BACKUP_JSON_CTA}
              </Button>
              <UseCloudConfirm onConfirm={ctx.useCloud} />
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="grid gap-2">
            <p className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-slate-600">
              {meta.lastError ? (
                <>
                  <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  <span className="font-semibold">{meta.lastError}</span>
                </>
              ) : (
                <>
                  <CloudOff size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="font-semibold">Não foi possível concluir a sincronização.</span>
                </>
              )}
            </p>
            <div>
              <Button variant="secondary" size="sm" onClick={runRetry} disabled={busyAction !== null}>
                <RefreshCw size={14} />
                {busyAction === "retry" ? "Tentando…" : "Tentar novamente"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
