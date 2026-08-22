"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Compass,
  LogOut,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { Compensation, DayResult, WorkSettings } from "@/lib/types";
import { expectedMinutesOf, formatMinutes, plannedExitTime, toMinutes } from "@/lib/time";
import { kindOf, pendingForTarget } from "@/lib/debt";
import { Badge, Button, Card } from "@/components/ui";

export type ExitState = "no-punch" | "planned" | "overdue" | "goal-reached" | "finished";

export interface SmartExitPlan {
  kind: "normal" | "earlier" | "extra";
  targetMinutes: number;
  /** Horário-alvo calculado a partir das batidas — independente da hora atual. */
  plannedExit: string | null;
  /** Minutos de atraso em relação à saída planejada (0 se ainda não venceu). */
  lateMinutes: number;
  state: ExitState;
  earlyMinutes: number;
  extraMinutes: number;
  comps: Compensation[];
}

/** FUNÇÃO CENTRAL do Smart Exit: calcula o plano de saída do dia. */
export function buildExitPlan(
  day: DayResult,
  settings: WorkSettings,
  comps: Compensation[],
  nowMinutes: number,
  date: string,
  /** Jornada esperada efetiva do dia (reduzida por férias/afastamentos), quando houver. */
  effectiveExpected?: number,
): SmartExitPlan {
  const base = effectiveExpected ?? day.expectedMinutes ?? expectedMinutesOf(settings);
  const targeted = pendingForTarget(comps, date);

  const earlyMinutes = targeted
    .filter((c) => kindOf(c) === "excedente")
    .reduce((s, c) => s + c.minutes, 0);
  const extraMinutes = targeted
    .filter((c) => kindOf(c) === "deficit")
    .reduce((s, c) => s + c.minutes, 0);

  const cappedExtra = Math.min(extraMinutes, Math.max(0, settings.maxDailyMinutes - base));
  const kind: SmartExitPlan["kind"] =
    earlyMinutes > 0 ? "earlier" : cappedExtra > 0 ? "extra" : "normal";

  const targetMinutes =
    kind === "earlier"
      ? Math.max(0, base - earlyMinutes)
      : kind === "extra"
        ? Math.min(settings.maxDailyMinutes, base + cappedExtra)
        : base;

  // Horário planejado: derivado das batidas, NUNCA da hora atual
  const plannedExit = plannedExitTime(day.entries, settings, targetMinutes);

  let state: ExitState;
  if (day.entries.length === 0) {
    state = "no-punch";
  } else if (plannedExit === null) {
    state = "finished"; // última batida é saída → jornada encerrada
  } else if (kind === "extra" && day.workedMinutes >= targetMinutes) {
    // Meta de compensação por hora extra atingida (confirmação manual)
    state = "goal-reached";
  } else if (nowMinutes > toMinutes(plannedExit)) {
    // Saída planejada venceu e o ponto continua aberto
    state = "overdue";
  } else if (day.workedMinutes >= targetMinutes) {
    state = "goal-reached"; // rendeu acima do previsto antes do horário
  } else {
    state = "planned";
  }

  const lateMinutes =
    plannedExit !== null && nowMinutes > toMinutes(plannedExit)
      ? nowMinutes - toMinutes(plannedExit)
      : 0;

  return {
    kind,
    targetMinutes,
    plannedExit,
    lateMinutes,
    state,
    earlyMinutes,
    extraMinutes: cappedExtra,
    comps: targeted,
  };
}

interface Props {
  date: string;
  day: DayResult;
  settings: WorkSettings;
  comps: Compensation[];
  nowMinutes: number;
  /** Registra a saída (hora atual) e quita as compensações de saída antecipada. */
  onSmartExit: (time: string, compIds: number[]) => Promise<void>;
  /** Confirma a quitação de compensações por hora extra (sem registrar saída). */
  onConfirmComps?: (compIds: number[]) => Promise<void>;
  isToday?: boolean;
  /** Jornada esperada efetiva (com ausências já descontadas), quando houver. */
  effectiveExpected?: number;
}

export function SmartExit({
  date,
  day,
  settings,
  comps,
  nowMinutes,
  onSmartExit,
  onConfirmComps,
  isToday,
  effectiveExpected,
}: Props) {
  const plan = useMemo(
    () => buildExitPlan(day, settings, comps, nowMinutes, date, effectiveExpected),
    [day, settings, comps, nowMinutes, date, effectiveExpected],
  );

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const deficitComps = plan.comps.filter((c) => kindOf(c) === "deficit");
  const earlyComps = plan.comps.filter((c) => kindOf(c) === "excedente");

  /** Registra a saída com a HORA ATUAL (nunca com o horário planejado vencido). */
  const registerNow = async () => {
    const now = `${String(Math.floor(nowMinutes / 60)).padStart(2, "0")}:${String(nowMinutes % 60).padStart(2, "0")}`;
    setBusy(true);
    try {
      await onSmartExit(now, earlyComps.map((c) => c.id));
    } finally {
      setBusy(false);
    }
  };

  const confirmSettlement = async () => {
    if (!onConfirmComps) return;
    setConfirming(true);
    try {
      await onConfirmComps(deficitComps.map((c) => c.id));
    } finally {
      setConfirming(false);
    }
  };

  /* ── Estado: sem batidas ─────────────────────────────── */
  if (plan.state === "no-punch") {
    return (
      <Card title="Previsão de saída" subtitle="Assistente de jornada">
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <Compass size={18} className="mt-0.5 shrink-0 text-slate-400" />
          <p className="text-sm text-slate-600">
            Registre sua <b>entrada</b> para o app calcular a previsão de saída
            {isToday ? " de hoje" : ""}. Com base na jornada de{" "}
            <b>{formatMinutes(day.expectedMinutes || expectedMinutesOf(settings))}</b>, a saída
            prevista é <b>{plan.plannedExit}</b>.
          </p>
        </div>
      </Card>
    );
  }

  /* ── Estado: jornada encerrada ───────────────────────── */
  if (plan.state === "finished") {
    return (
      <Card
        title="Previsão de saída"
        subtitle="Assistente de jornada"
        actions={<Badge tone="slate">Jornada encerrada</Badge>}
      >
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
          <p className="text-sm text-slate-600">
            Jornada encerrada com <b>{formatMinutes(day.workedMinutes)}</b> trabalhadas. Saldo do
            dia:{" "}
            <b className={day.balanceMinutes >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {day.balanceMinutes >= 0 ? "+" : ""}
              {formatMinutes(day.balanceMinutes)}
            </b>
          </p>
        </div>
      </Card>
    );
  }

  /* ── Estados com ponto aberto ────────────────────────── */
  const goalReached = plan.state === "goal-reached";
  const overdue = plan.state === "overdue" || goalReached;

  const badge =
    plan.kind === "earlier" ? (
      <Badge tone="sky">Sair mais cedo</Badge>
    ) : plan.kind === "extra" ? (
      <Badge tone="emerald">Compensar com hora extra</Badge>
    ) : (
      <Badge tone="slate">Jornada padrão</Badge>
    );

  const message = goalReached
    ? plan.kind === "extra"
      ? "Meta de compensação atingida ✓"
      : "Meta da jornada atingida — você já pode sair."
    : plan.kind === "earlier"
      ? `Você tem ${formatMinutes(plan.earlyMinutes)} para compensar hoje. Saída planejada: ${plan.plannedExit}.`
      : plan.kind === "extra"
        ? `Trabalhe até ${plan.plannedExit} para abater ${formatMinutes(plan.extraMinutes)} da sua pendência (limite de ${formatMinutes(settings.maxDailyMinutes)}/dia).`
        : `Para completar sua jornada de ${formatMinutes(plan.targetMinutes)}, a saída planejada é ${plan.plannedExit}.`;

  return (
    <Card title="Previsão de saída" subtitle="Planejada a partir das suas batidas — não do relógio" actions={badge}>
      <div className="flex flex-wrap items-center gap-4">
        {/* Horário planejado */}
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${
              plan.kind === "earlier"
                ? "bg-sky-100 text-sky-600"
                : plan.kind === "extra"
                  ? "bg-emerald-100 text-emerald-600"
                  : "bg-indigo-100 text-indigo-600"
            }`}
          >
            {plan.kind === "extra" ? <TrendingUp size={20} /> : <Timer size={20} />}
          </div>
          <div>
            <p className="text-2xl font-extrabold tabular-nums tracking-tight text-slate-900">
              {plan.plannedExit}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              saída planejada
            </p>
          </div>
        </div>

        {/* Detalhes */}
        <div className="min-w-[200px] flex-1">
          <p
            className={`text-sm font-semibold ${
              goalReached
                ? "text-emerald-700"
                : plan.kind === "earlier"
                  ? "text-sky-700"
                  : plan.kind === "extra"
                    ? "text-emerald-700"
                    : "text-slate-700"
            }`}
          >
            {message}
          </p>

          {goalReached && plan.kind === "extra" && (
            <p className="mt-1 text-xs text-slate-500">
              Você completou os <b>{formatMinutes(plan.extraMinutes)}</b> de hora extra previstos
              para quitar o déficit de{" "}
              {deficitComps.map((c) => c.sourceDate.slice(8) + "/" + c.sourceDate.slice(5, 7)).join(", ")}.
            </p>
          )}

          {overdue && !goalReached && (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-600">
              <Clock3 size={12} />
              Sua saída planejada já passou há {formatMinutes(plan.lateMinutes)}. O ponto continua
              aberto.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              Trabalhado: <b className="text-slate-700">{formatMinutes(day.workedMinutes)}</b>
            </span>
            <span>
              Meta: <b className="text-slate-700">{formatMinutes(plan.targetMinutes)}</b>
            </span>
            {!goalReached && (
              <span>
                Faltam:{" "}
                <b className="text-slate-700">
                  {formatMinutes(Math.max(0, plan.targetMinutes - day.workedMinutes))}
                </b>
              </span>
            )}
          </div>

          {plan.comps.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plan.comps.map((c) => (
                <span
                  key={c.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    kindOf(c) === "excedente"
                      ? "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200"
                      : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                  }`}
                >
                  −{formatMinutes(c.minutes)} · {kindOf(c) === "excedente" ? "sair cedo" : "hora extra"}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Ações — nunca registrar hora futura nem oferecer botão com jornada encerrada */}
        <div className="flex flex-col gap-2">
          {goalReached && plan.kind === "extra" && onConfirmComps && deficitComps.length > 0 && (
            <Button size="lg" onClick={confirmSettlement} loading={confirming}>
              <CheckCircle2 size={17} /> Confirmar quitação
            </Button>
          )}
          {overdue ? (
            <Button
              size={goalReached && plan.kind === "extra" ? "md" : "lg"}
              variant={goalReached && plan.kind === "extra" ? "secondary" : "primary"}
              loading={busy}
              onClick={registerNow}
              className={plan.kind === "extra" && !goalReached ? "!bg-emerald-600 hover:!bg-emerald-700" : ""}
            >
              <LogOut size={17} /> Registrar saída agora
            </Button>
          ) : (
            <Button size="lg" variant="secondary" disabled>
              <LogOut size={17} /> Aguardando horário
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
