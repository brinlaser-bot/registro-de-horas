"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Badge, Button, ConfirmDialog } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions } from "@/lib/store";
import { specialExcessPlanMinutes, type SpecialExcessPlan } from "@/lib/special-excess-plan";
import { formatDateShortBR, formatMinutes } from "@/lib/time";

interface Props {
  /** Planos ATIVOS ("planned") deste dia (fonte: activeSpecialPlansForDate). */
  plans: SpecialExcessPlan[];
  /** true quando o destino ainda é futuro (oferece "Planejar mais"). */
  isFuture: boolean;
  /** Abre o modal "Planejar uso de [10+]" (só passado quando o dia é futuro). */
  onPlan?: () => void;
}

/**
 * Bloco SEPARADO do card do dia com as RESERVAS [10+] (Etapa 4B).
 *
 * - PLANEJADO NÃO É UTILIZADO: nada aqui altera trabalhado/saldo factual/
 *   batidas/projeção — a reserva é uma SEGUNDA informação do dia, ao lado
 *   do status factual (que permanece intocado e dominante).
 * - Vários planos no mesmo destino → total agregado + cada plano em linha
 *   (ids nunca mesclados no domínio).
 * - Cancelamento INDIVIDUAL (cancelSpecialExcessPlan, 4A) com confirmação
 *   simples; o histórico permanece preservado como "cancelled".
 * - Data chegou (hoje/passado): NADA é concluído/convertido/liberado
 *   automaticamente — texto neutro "Planejamento aguardando confirmação" e
 *   "Cancelar reserva" continua disponível. "Planejar mais" não é oferecido.
 * - "Concluir" NÃO existe nesta etapa (PLANO → USO é etapa posterior).
 */
export function SpecialExcessPlanSummary({ plans, isFuture, onPlan }: Props) {
  const toast = useToast();
  const [cancelTarget, setCancelTarget] = useState<SpecialExcessPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const total = plans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0);

  const doCancel = async () => {
    if (!cancelTarget || busy) return;
    const id = cancelTarget.id;
    const minutes = specialExcessPlanMinutes(cancelTarget);
    setBusy(true);
    try {
      const res = actions.cancelSpecialExcessPlan({ id });
      if (res.ok) {
        toast.show(`Reserva cancelada: ${formatMinutes(minutes)} voltaram ao Banco [10+] disponível.`);
      } else {
        toast.show(res.error ?? "Não foi possível cancelar a reserva.", "error");
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
          <CalendarClock size={13} aria-hidden /> [10+]
        </Badge>
        <p className="min-w-0 flex-1 text-xs font-semibold text-violet-900">
          {isFuture ? (
            <>
              [10+] reservado: <b className="tabular-nums">{formatMinutes(total)}</b>
            </>
          ) : (
            <span className="font-medium text-violet-800/80">Planejamento aguardando confirmação</span>
          )}
        </p>
        {isFuture && onPlan && (
          <Button
            size="sm"
            variant="secondary"
            className="w-full !border-violet-300 !text-violet-700 hover:!bg-violet-50 sm:w-auto"
            onClick={onPlan}
          >
            <CalendarClock size={13} /> Planejar mais
          </Button>
        )}
      </div>

      {/* Detalhe por plano (origens + modo + cancelamento individual) */}
      <ul className="space-y-1.5">
        {plans.map((p, i) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-violet-900"
          >
            <span className="font-bold tabular-nums">
              {plans.length > 1 ? `Plano ${i + 1}` : "Reserva"} — {formatMinutes(specialExcessPlanMinutes(p))}
            </span>
            <span className="min-w-0 flex-1">
              Origem:{" "}
              {p.allocations.map((a) => `${formatDateShortBR(a.originDate)} — ${formatMinutes(a.minutes)}`).join(" · ")}
              <span className="text-violet-600">
                {" "}
                · {p.selectionMode === "automatic" ? "Seleção automática" : "Origem escolhida manualmente"}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="!px-2 !text-rose-600 hover:!bg-rose-50"
              onClick={() => setCancelTarget(p)}
            >
              Cancelar reserva
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Cancelar reserva de [10+]"
        message={
          cancelTarget ? (
            <>
              <p>
                Cancelar esta reserva de <b>{formatMinutes(specialExcessPlanMinutes(cancelTarget))}</b>?
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                {formatMinutes(specialExcessPlanMinutes(cancelTarget))} voltará a ficar disponível no Banco [10+]. Sua
                jornada e seu saldo regular continuam inalterados.
              </p>
            </>
          ) : null
        }
        confirmLabel="Cancelar reserva"
        onConfirm={doCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
