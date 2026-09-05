"use client";

/**
 * ETAPA 4K — Indicador discreto de sincronização (área do usuário na sidebar).
 *
 * Uma linha pequena sob o e-mail: ponto colorido + estado em português, com
 * atalho para Configurações. Fora do provedor ou sem conta resolvida, não
 * renderiza nada.
 */
import Link from "next/link";
import { useIsClient } from "@/lib/store";
import { SYNC_STATUS_LABEL, type SyncStatus } from "@/lib/cloud-sync/metadata";
import { useCloudSyncOptional } from "./cloud-sync-provider";

const DOT: Record<SyncStatus, string> = {
  "not-started": "bg-slate-500",
  syncing: "bg-sky-400 animate-pulse",
  synced: "bg-emerald-400",
  pending: "bg-amber-400",
  conflict: "bg-red-400",
  error: "bg-red-400",
};

export function SyncStatusLine() {
  const mounted = useIsClient();
  const ctx = useCloudSyncOptional();
  if (!mounted || !ctx || !ctx.userId || ctx.phase !== "ready") return null;
  return (
    <Link
      href="/configuracoes"
      className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200"
      aria-label={`Sincronização: ${SYNC_STATUS_LABEL[ctx.status]}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[ctx.status]}`} aria-hidden />
      <span className="truncate">{SYNC_STATUS_LABEL[ctx.status]}</span>
    </Link>
  );
}
