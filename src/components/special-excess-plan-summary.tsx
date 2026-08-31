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
  /**
   * 4C — decisão: o dia é elegível (realizado, financeiramente válido) e a
   * necessidade restante do dia (3A/3G, considerando usos ativos).
   * `eligible = null` quando não há visão canônica do dia (incompleto,
   * inconsistente, congelado) → "Aplicar" não é oferecido (§6).
   */
  eligible?: boolean | null;
  remainingNeedMinutes?: number | null;
  /** Abre o modal "Usar planejamento [10+]" para o plano informado. */
  onResolvePlan?: (planId: string) => void;
  /** Abre o modal "Planejar uso de [10+]" (só passado quando o dia é futuro). */
  onPlan?: () => void;
}

/**
 * Bloco SEPARADO do card do dia com as RESERVAS [10+] (Etapas 4B/4C).
 *
 * - PLANEJADO NÃO É UTILIZADO: nada aqui altera trabalhado/saldo do dia,
 *   batidas ou projeção — a reserva é uma SEGUNDA informação do dia, ao
 *   lado do status real (que permanece intocado e dominante).
 * - Vários planos no mesmo destino → total agregado + cada plano em linha
 *   (ids nunca mesclados no domínio; resolução INDIVIDUAL por plano — §15).
 * - FUTURO: apenas reserva ("Planejar mais").
 * - DIA CHEGOU (hoje/passado): "Planejamento aguardando confirmação" —
 *   NADA é convertido automaticamente (§4); somente ação explícita:
 *    · dia elegível com necessidade > 0 → "Usar planejamento" (modal 4C);
 *    · necessidade 0 → "Sua jornada já atingiu a base…" + "Liberar reserva";
 *    · dia incompleto/inconsistente → orientação corrigir + "Cancelar
 *      reserva" (liberar saldo continua sempre possível — §6);
 * - Cancelamento individual (cancelSpecialExcessPlan, 4A) com confirmação
 *   simples; histórico permanece preservado como "cancelled".
 * - "Concluir"/conversão automática NÃO existem nesta UI (a resolução é
 *   sempre uma decisão explícita pelo modal; PLANO → USO no store 4C).
 */
export function SpecialExcessPlanSummary({ plans, isFuture, eligible = null, remainingNeedMinutes = null, onResolvePlan, onPlan }: Props) {
  const toast = useToast();
  const [cancelTarget, setCancelTarget] = useState<SpecialExcessPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const total = plans.reduce((s, p) => s + specialExcessPlanMinutes(p), 0);
  const arrived = !isFuture;
  const needRemaining = remainingNeedMinutes ?? 0;
  // §5/§25: aplicar só faz sentido com o dia chegado, realizado e válido,
  // com necessidade real restante — verdade lida dos motores 3A/3G (a UI
  // não recalcula necessidade; o store continua o gate final).
  const canApply = arrived && eligible === true && needRemaining > 0;
  const needZero = arrived && eligible === true && needRemaining <= 0;
  const dayBlocked = arrived && eligible !== true;
  const cancelLabel = needZero ? "Liberar reserva" : "Cancelar reserva";

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
            <>
              Planejamento aguardando confirmação{" "}
              <span className="font-medium text-violet-700">
                · <b className="tabular-nums">{formatMinutes(total)}</b> reservados
              </span>
            </>
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

      {/* 4C — orientação quando o dia chegou (§6/§13): a UI informa, o store
          continua o gate final. Nenhum déficit é inventado aqui. */}
      {dayBlocked && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
          Complete ou corrija os registros deste dia antes de decidir o uso do [10+].
        </p>
      )}
      {needZero && (
        <p className="rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold text-violet-800">
          Sua jornada já atingiu a base. Esta reserva não é mais necessária.
        </p>
      )}

      {/* Detalhe por plano (origens + modo + decisão individual §15) */}
      <ul className="space-y-1.5">
        {plans.map((p, i) => {
          const planMinutes = specialExcessPlanMinutes(p);
          return (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-violet-900"
            >
              <span className="font-bold tabular-nums">
                {plans.length > 1 ? `Plano ${i + 1}` : "Reserva"} — {formatMinutes(planMinutes)}
              </span>
              <span className="min-w-0 flex-1">
                Origem:{" "}
                {p.allocations.map((a) => `${formatDateShortBR(a.originDate)} — ${formatMinutes(a.minutes)}`).join(" · ")}
                <span className="text-violet-600">
                  {" "}
                  · {p.selectionMode === "automatic" ? "Seleção automática" : "Origem escolhida manualmente"}
                </span>
              </span>
              {canApply && onResolvePlan && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="!border-violet-300 !text-violet-700 hover:!bg-violet-50"
                  onClick={() => onResolvePlan(p.id)}
                >
                  <CalendarClock size={12} /> Usar planejamento
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="!px-2 !text-rose-600 hover:!bg-rose-50"
                onClick={() => setCancelTarget(p)}
              >
                {cancelLabel}
              </Button>
            </li>
          );
        })}
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
        confirmLabel={cancelLabel}
        onConfirm={doCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
