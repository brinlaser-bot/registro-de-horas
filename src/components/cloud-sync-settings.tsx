"use client";

/**
 * ETAPA 4K — Cartão "Sincronização entre dispositivos" (Configurações).
 *
 * Concentra a UX de sync: estado atual, primeira ativação ("Usar estes dados
 * na minha conta", com backup de segurança BACKUP v3 antes), retentativa
 * manual e resolução de conflito (backup local + "Usar versão da nuvem" com
 * confirmação). Nenhuma ação automática parte daqui.
 */
import { useState } from "react";
import { CheckCircle2, CloudOff, Download, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useAppData, useIsClient } from "@/lib/store";
import {
  downloadLocalBackup,
  isEmptyOperationalState,
} from "@/lib/cloud-sync/canonical";
import {
  MSG_ACTIVATE_CTA,
  MSG_BACKUP_CTA,
  MSG_BACKUP_DEVICE_CTA,
  MSG_CONFLICT_EXPLAIN,
  MSG_CONFLICT_TITLE,
  MSG_USE_CLOUD_CTA,
} from "@/lib/cloud-sync/engine";
import { SYNC_STATUS_LABEL, type SyncStatus } from "@/lib/cloud-sync/metadata";
import { CloudSyncActivationCopy, useCloudSyncOptional } from "./cloud-sync-provider";
import { Button, Card } from "@/components/ui";

const DOT: Record<SyncStatus, string> = {
  "not-started": "bg-slate-400",
  syncing: "bg-sky-500 animate-pulse",
  synced: "bg-emerald-500",
  pending: "bg-amber-500",
  conflict: "bg-red-500",
  error: "bg-red-500",
};

function StatusRow({ status }: { status: SyncStatus }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} aria-hidden />
      <p className="text-sm font-extrabold text-slate-900">{SYNC_STATUS_LABEL[status]}</p>
    </div>
  );
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
        {MSG_USE_CLOUD_CTA}
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
  const [busyAction, setBusyAction] = useState<"activate" | "retry" | null>(null);

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

  return (
    <Card
      title="Sincronização entre dispositivos"
      subtitle="A mesma conta no celular e no computador, sem exportar/importar"
    >
      <div className="grid gap-3">
        <StatusRow status={status} />

        {status === "not-started" && (
          <div className="grid gap-3">
            <CloudSyncActivationCopy />
            {!localEmpty && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                Por segurança, guarde uma cópia antes de ativar.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={downloadLocalBackup}>
                <Download size={14} /> {MSG_BACKUP_CTA}
              </Button>
              <Button size="sm" onClick={runActivate} disabled={busyAction !== null}>
                {busyAction === "activate" ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Ativando…
                  </>
                ) : (
                  MSG_ACTIVATE_CTA
                )}
              </Button>
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
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={downloadLocalBackup}>
                <Download size={14} /> {MSG_BACKUP_DEVICE_CTA}
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
    </Card>
  );
}
