"use client";

import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Badge, Button, Input, Modal } from "@/components/ui";
import { useToast } from "@/components/toast";
import { actions, settingsOf, useAppData } from "@/lib/store";
import { buildSpecialExcessDayView } from "@/lib/special-excess-day-view";
import { specialExcessPlanMinutes, type SpecialExcessPlan } from "@/lib/special-excess-plan";
import { formatDateShortBR, formatMinutes, todayString } from "@/lib/time";

interface Props {
  /** Plano ATIVO ("planned") cujo destinationDate JÁ chegou. */
  plan: SpecialExcessPlan;
  onClose: () => void;
}

/** Traduz os codes da resolução 4C para mensagens simples (sem código técnico). */
function translateResolveError(code: string | undefined, fallback?: string): string {
  switch (code) {
    case "destination-not-realized":
      return "O planejamento ainda é uma reserva futura.";
    case "destination-not-eligible":
      return "Complete ou corrija os registros deste dia antes de decidir o uso do [10+].";
    case "destination-no-remaining-need":
      return "Sua jornada já atingiu a base. Esta reserva não é mais necessária — libere a reserva.";
    case "requested-exceeds-destination-need":
      return "Esse valor ultrapassa a necessidade restante do dia.";
    case "plan-already-cancelled":
    case "plan-already-concluded":
      return "Este planejamento já foi resolvido.";
    case "plan-not-found":
      return "Planejamento não encontrado.";
    default:
      return fallback ?? "Não foi possível usar o planejamento de [10+].";
  }
}

const QUICK_OPTIONS = [15, 30, 45, 60];

/**
 * Modal "Usar planejamento [10+]" (Etapa 4C) — decisão explícita sobre o
 * plano quando o dia planejado chegou. PLANO NUNCA VIRA USO
 * AUTOMATICAMENTE: tudo acontece só aqui, via resolveSpecialExcessPlan
 * (atômico no store; o store é o gate final).
 *
 * - Necessidade atual lida do motor canônico (buildSpecialExcessDayView —
 *   3A/3G, considerando jornada factual, base efetiva e usos ativos do
 *   dia). A UI NÃO recalcula necessidade (§5).
 * - Máximo aplicável = min(reservado no plano, necessidade restante).
 * - Sem Automático/Manual: as origens JÁ foram escolhidas na reserva (§10)
 *   — o preview mostra o PREFIXO das allocations persistidas que será
 *   consumido; a sobra volta ao Banco [10+].
 * - "Concluir" não é um botão: a resolução é o próprio uso (§3/§26).
 */
export function SpecialExcessPlanResolveModal({ plan, onClose }: Props) {
  const { user, entries, absences, companyCalendars, faltas, specialExcessUses, specialExcessPlans } = useAppData();
  const toast = useToast();
  const todayStr = todayString();
  const settings = settingsOf(user);

  // Verdade canônica do dia (3A/3G): elegibilidade + necessidade restante
  // considerando os usos [10+] já ativos no destino.
  const view = useMemo(
    () =>
      buildSpecialExcessDayView({
        date: plan.destinationDate,
        asOfDate: todayStr,
        entries,
        absences,
        calendars: companyCalendars,
        settings,
        faltas,
        controlStartDate: user.controlStartDate ?? null,
        uses: specialExcessUses ?? [],
        plans: specialExcessPlans ?? [],
      }),
    [plan.destinationDate, todayStr, entries, absences, companyCalendars, settings, faltas, user.controlStartDate, specialExcessUses, specialExcessPlans],
  );

  const planMinutes = specialExcessPlanMinutes(plan);
  const maxApplicable = Math.min(planMinutes, view.remainingMinutes);

  const [amountDraft, setAmountDraft] = useState<string>(String(maxApplicable));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = Math.max(0, Math.floor(Number(amountDraft) || 0));
  const amountOver = amount > maxApplicable;
  const leftOver = Math.max(0, planMinutes - amount);

  // §10: preview = PREFIXO das allocations persistidas do plano (sem FIFO).
  const preview = useMemo(() => {
    let toConsume = amount;
    const out: Array<{ originDate: string; minutes: number }> = [];
    for (const a of plan.allocations) {
      if (toConsume <= 0) break;
      const take = Math.min(a.minutes, toConsume);
      if (take > 0) out.push({ originDate: a.originDate, minutes: take });
      toConsume -= take;
    }
    return out;
  }, [amount, plan.allocations]);

  const confirm = async () => {
    if (busy) return;
    if (amount < 1) {
      setError("Informe quanto do planejado deseja utilizar.");
      return;
    }
    if (amountOver) {
      setError(`O máximo aplicável agora é ${formatMinutes(maxApplicable)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = actions.resolveSpecialExcessPlan({ id: plan.id, minutes: amount });
      if (!res.ok) {
        setError(translateResolveError(res.code, res.error));
        return;
      }
      toast.show(
        leftOver > 0
          ? `${formatMinutes(amount)} de [10+] aplicados do planejamento · ${formatMinutes(leftOver)} liberados no Banco [10+].`
          : `${formatMinutes(amount)} de [10+] aplicados do planejamento.`,
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Usar planejamento [10+]"
      subtitle={`Dia ${formatDateShortBR(plan.destinationDate)} · reserva de ${formatMinutes(planMinutes)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            onClick={confirm}
            loading={busy}
            disabled={amount < 1 || amountOver}
            className="!bg-violet-600 hover:!bg-violet-700 active:!bg-violet-800"
          >
            <CalendarClock size={15} /> Usar planejamento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 rounded-xl bg-slate-50 px-3.5 py-3 text-xs">
          <div>
            <dt className="text-slate-500">Planejado</dt>
            <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(planMinutes)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Necessidade atual</dt>
            <dd className="font-bold tabular-nums text-slate-900">{formatMinutes(view.remainingMinutes)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Máximo aplicável</dt>
            <dd className="font-bold tabular-nums text-violet-700">{formatMinutes(maxApplicable)}</dd>
          </div>
        </dl>

        <p className="rounded-xl bg-violet-50 px-3.5 py-2.5 text-xs font-medium text-violet-900">
          O valor utilizado será aplicado somente à projeção do ponto. Sua jornada real e seu saldo regular continuarão
          inalterados.
        </p>

        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Quanto do planejado deseja utilizar?
          </span>
          <div className="relative">
            <Input
              type="number"
              min={1}
              max={maxApplicable}
              inputMode="numeric"
              value={amountDraft}
              onChange={(e) => {
                setAmountDraft(e.target.value);
                setError(null);
              }}
              aria-label="Minutos do planejamento a utilizar"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">min</span>
          </div>
          <span className="mt-1 block text-xs text-slate-400">Máximo agora: {formatMinutes(maxApplicable)}</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_OPTIONS.filter((m) => m <= maxApplicable).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setAmountDraft(String(m));
                  setError(null);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  amount === m ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-700 hover:bg-violet-100"
                }`}
              >
                {formatMinutes(m)}
              </button>
            ))}
          </div>
        </div>

        {leftOver > 0 && amount > 0 && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-600">
            Os {formatMinutes(leftOver)} restantes serão liberados para o Banco [10+].
          </p>
        )}

        {preview.length > 0 && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Origem das horas reservadas</p>
            <ul className="mt-1.5 space-y-1 text-xs font-medium text-violet-900">
              {preview.map((a) => (
                <li key={a.originDate} className="flex items-center justify-between gap-3">
                  <span>{formatDateShortBR(a.originDate)}</span>
                  <span className="font-bold tabular-nums">{formatMinutes(a.minutes)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between border-t border-violet-200 pt-1 font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatMinutes(preview.reduce((s, a) => s + a.minutes, 0))}</span>
              </li>
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Badge tone="violet" className="shrink-0">
            <CalendarClock size={11} aria-hidden /> [10+]
          </Badge>
          As origens já foram escolhidas na reserva — nenhum novo sorteio é feito.
        </p>
      </div>
    </Modal>
  );
}
