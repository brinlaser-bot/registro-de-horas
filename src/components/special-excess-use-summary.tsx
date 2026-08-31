"use client";

import { useState } from "react";
import { Timer } from "lucide-react";
import { Badge, Button, ConfirmDialog } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions } from "@/lib/store";
import { specialExcessUseMinutes, type SpecialExcessUse } from "@/lib/special-excess-use";
import type { SpecialExcessDayView } from "@/lib/special-excess-day-view";
import { formatDateShortBR, formatMinutes } from "@/lib/time";

interface Props {
  /** Visão do dia derivada 3A/3C (fonte única). */
  view: SpecialExcessDayView;
  /** Abre o modal "Completar jornada com [10+]". */
  onOpen?: () => void;
}

/**
 * Bloco SEPARADO do card do dia com o uso de [10+] (Etapa 3E).
 *
 * - NÃO altera Trabalhado/Saldo factual/batidas (fato continua factual).
 * - Mostra AGREGADO dos usos ativos + detalhe por uso (origens + estratégia).
 * - Projeção no ponto vem do motor 3A (view.projection).
 * - Cancelamento é INDIVIDUAL (cancelSpecialExcessUse, 3D) — "Cancelar uso"
 *   (nunca remoção definitiva): o histórico permanece rastreável como cancelado.
 * - Vários usos no mesmo destino → card mostra o total + cada uso em linha.
 */
export function SpecialExcessUseSummary({ view, onOpen }: Props) {
  const toast = useToast();
  const [cancelTarget, setCancelTarget] = useState<SpecialExcessUse | null>(null);
  const [busy, setBusy] = useState(false);

  const hasActive = view.activeUses.length > 0;

  const doCancel = async () => {
    if (!cancelTarget || busy) return;
    const id = cancelTarget.id;
    const minutes = specialExcessUseMinutes(cancelTarget);
    setBusy(true);
    try {
      const res = actions.cancelSpecialExcessUse({ id });
      if (res.ok) {
        toast.show(`${formatMinutes(minutes)} de [10+] devolvidos ao saldo disponível.`);
      } else {
        toast.show(res.error ?? "Não foi possível cancelar o uso.", "error");
      }
      setCancelTarget(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Linha principal: agregado + ação */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone="violet" className="shrink-0 py-1">
          <Timer size={13} aria-hidden /> [10+]
        </Badge>
        {hasActive ? (
          <p className="min-w-0 flex-1 text-xs font-semibold text-violet-900">
            [10+] utilizado: <b className="tabular-nums">{formatMinutes(view.usedActiveMinutes)}</b>
          </p>
        ) : view.bankAvailableMinutes === 0 ? (
          <p className="min-w-0 flex-1 text-xs font-medium text-violet-800/80">
            Sem saldo [10+] disponível para completar este dia.
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-xs font-medium text-violet-800/80">
            Faltam <b className="tabular-nums">{formatMinutes(view.remainingMinutes)}</b> para completar a jornada.
          </p>
        )}
        {view.canComplete && onOpen && (
          <Button
            size="sm"
            variant="secondary"
            className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"
            onClick={onOpen}
          >
            <Timer size={13} /> {hasActive ? "Completar mais com [10+]" : "Completar jornada com [10+]"}
          </Button>
        )}
      </div>

      {/* Projeção no ponto (motor 3A) */}
      {hasActive && view.projection && (
        <div className="rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold text-violet-800">
          Projeção no ponto: <b className="tabular-nums">{formatMinutes(view.projection.workedMinutes)}</b>
          <span className="mx-1.5 text-violet-300" aria-hidden>
            ·
          </span>
          Saldo projetado:{" "}
          <b className={`tabular-nums ${view.projection.balanceMinutes < 0 ? "text-rose-600" : "text-emerald-600"}`}>
            {view.projection.balanceMinutes > 0 ? "+" : ""}
            {formatMinutes(view.projection.balanceMinutes)}
          </b>
          {/* 3G.3: uso TOTAL (necessidade zerada) — indica que a projeção
              ficou completa. Uso parcial NÃO mostra (a jornada segue
              pendente). Nada aqui altera o factual. */}
          {view.remainingMinutes === 0 && (
            <p className="mt-0.5 font-bold text-violet-700">Projeção completada com [10+]</p>
          )}
        </div>
      )}

      {/* Detalhe por uso (origens + estratégia + cancelamento individual) */}
      {hasActive && (
        <ul className="space-y-1.5">
          {view.activeUses.map((u, i) => {
            const m = specialExcessUseMinutes(u);
            return (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-violet-900"
              >
                <span className="font-bold tabular-nums">
                  Uso {i + 1} — {formatMinutes(m)}
                </span>
                <span className="min-w-0 flex-1">
                  Origem:{" "}
                  {u.allocations.map((a) => `${formatDateShortBR(a.originDate)} — ${formatMinutes(a.minutes)}`).join(" · ")}
                  <span className="text-violet-600">
                    {" "}
                    · {u.allocationStrategy === "fifo" ? "Seleção automática" : "Origem escolhida manualmente"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="!px-2 !text-rose-600 hover:!bg-rose-50"
                  onClick={() => setCancelTarget(u)}
                >
                  Cancelar uso de [10+]
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancelar uso de [10+]"
        message={
          cancelTarget ? (
            <>
              <p>
                Cancelar este uso de <b>{formatMinutes(specialExcessUseMinutes(cancelTarget))}</b>?
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                O valor voltará ao saldo [10+] disponível e a jornada factual continuará inalterada.
              </p>
            </>
          ) : null
        }
        confirmLabel="Cancelar uso"
        onConfirm={doCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
