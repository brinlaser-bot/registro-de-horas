"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Compass, LogOut, Timer, TrendingUp, Zap } from "lucide-react";
import type { Compensation, DayResult, WorkSettings } from "@/lib/types";
import { expectedMinutesOf, formatMinutes, suggestExitTime } from "@/lib/time";
import { kindOf, pendingForTarget } from "@/lib/debt";
import { Badge, Button, Card } from "@/components/ui";

export interface SmartExitPlan {
  kind: "normal" | "earlier" | "extra";
  targetMinutes: number;
  exitTime: string | null;
  earlyMinutes: number;
  extraMinutes: number;
  comps: Compensation[];
  reachBaseAt: string | null;
}

/** Calcula o plano de saída do dia (normal / sair mais cedo / hora extra). */
export function buildExitPlan(
  day: DayResult,
  settings: WorkSettings,
  comps: Compensation[],
  nowMinutes: number,
  date: string,
): SmartExitPlan {
  const base = day.expectedMinutes || expectedMinutesOf(settings);
  const targeted = pendingForTarget(comps, date);

  const earlyMinutes = targeted
    .filter((c) => kindOf(c) === "excedente")
    .reduce((s, c) => s + c.minutes, 0);
  const extraMinutes = targeted
    .filter((c) => kindOf(c) === "deficit")
    .reduce((s, c) => s + c.minutes, 0);

  const cappedExtra = Math.min(extraMinutes, Math.max(0, settings.maxDailyMinutes - base));
  const kind: SmartExitPlan["kind"] = earlyMinutes > 0 ? "earlier" : cappedExtra > 0 ? "extra" : "normal";

  const targetMinutes =
    kind === "earlier"
      ? Math.max(0, base - earlyMinutes)
      : kind === "extra"
        ? Math.min(settings.maxDailyMinutes, base + cappedExtra)
        : base;

  return {
    kind,
    targetMinutes,
    exitTime: suggestExitTime(day.entries, settings, targetMinutes, nowMinutes),
    earlyMinutes,
    extraMinutes: cappedExtra,
    comps: targeted,
    reachBaseAt: suggestExitTime(day.entries, settings, base, nowMinutes),
  };
}

interface Props {
  date: string;
  day: DayResult;
  settings: WorkSettings;
  comps: Compensation[];
  nowMinutes: number;
  onSmartExit: (time: string, compIds: number[]) => Promise<void>;
  isToday?: boolean;
}

export function SmartExit({ date, day, settings, comps, nowMinutes, onSmartExit, isToday }: Props) {
  const plan = useMemo(
    () => buildExitPlan(day, settings, comps, nowMinutes, date),
    [day, settings, comps, nowMinutes, date],
  );

  const [busy, setBusy] = useState(false);

  const register = async () => {
    if (!plan.exitTime) return;
    setBusy(true);
    try {
      await onSmartExit(plan.exitTime, plan.comps.map((c) => c.id));
    } finally {
      setBusy(false);
    }
  };

  const remaining = Math.max(0, plan.targetMinutes - day.workedMinutes);
  const closed = !day.open && day.entries.length > 0;
  const canRegister = day.open && plan.exitTime !== null;

  if (day.entries.length === 0) {
    return (
      <Card title="Previsão de saída" subtitle="Assistente de jornada">
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <Compass size={18} className="mt-0.5 shrink-0 text-slate-400" />
          <p className="text-sm text-slate-600">
            Registre sua <b>entrada</b> para o app calcular a previsão de saída
            {isToday ? " de hoje" : ""}. Com base na jornada de{" "}
            <b>{formatMinutes(day.expectedMinutes || expectedMinutesOf(settings))}</b>, a saída
            prevista é <b>{plan.exitTime ?? "—"}</b>.
          </p>
        </div>
      </Card>
    );
  }

  const tone =
    plan.kind === "earlier" ? "sky" : plan.kind === "extra" ? "emerald" : "slate";

  const message =
    plan.kind === "earlier"
      ? `Você tem ${formatMinutes(plan.earlyMinutes)} para compensar hoje. Saia às ${plan.exitTime}.`
      : plan.kind === "extra"
        ? `Trabalhe até ${plan.exitTime} para abater ${formatMinutes(plan.extraMinutes)} da sua pendência (limite de ${formatMinutes(settings.maxDailyMinutes)}/dia).`
        : `Para completar sua jornada de ${formatMinutes(plan.targetMinutes)}, você deve sair às ${plan.exitTime}.`;

  return (
    <Card
      title="Previsão de saída"
      subtitle="Cálculo em tempo real com base na entrada, atrasos e almoço"
      actions={
        plan.kind === "earlier" ? (
          <Badge tone="sky">Sair mais cedo</Badge>
        ) : plan.kind === "extra" ? (
          <Badge tone="emerald">Compensar com hora extra</Badge>
        ) : (
          <Badge tone="slate">Jornada padrão</Badge>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        {/* Horário sugerido */}
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${
            plan.kind === "earlier"
              ? "bg-sky-100 text-sky-600"
              : plan.kind === "extra"
                ? "bg-emerald-100 text-emerald-600"
                : "bg-indigo-100 text-indigo-600"
          }`}>
            {plan.kind === "extra" ? <TrendingUp size={20} /> : <Timer size={20} />}
          </div>
          <div>
            <p className="text-2xl font-extrabold tabular-nums tracking-tight text-slate-900">
              {plan.exitTime ?? (closed ? "—" : "—")}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {closed ? "jornada encerrada" : "saída sugerida"}
            </p>
          </div>
        </div>

        {/* Detalhes */}
        <div className="min-w-[200px] flex-1">
          <p className={`text-sm font-semibold ${
            tone === "sky" ? "text-sky-700" : tone === "emerald" ? "text-emerald-700" : "text-slate-700"
          }`}>
            {message}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              Trabalhado: <b className="text-slate-700">{formatMinutes(day.workedMinutes)}</b>
            </span>
            <span>
              Meta: <b className="text-slate-700">{formatMinutes(plan.targetMinutes)}</b>
            </span>
            {!closed && remaining > 0 && (
              <span>
                Faltam: <b className="text-slate-700">{formatMinutes(remaining)}</b>
              </span>
            )}
            {plan.kind === "earlier" && plan.reachBaseAt && plan.reachBaseAt !== plan.exitTime && (
              <span className="text-slate-400">(base cheia às {plan.reachBaseAt})</span>
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

        {/* Ação de 1 clique */}
        <Button
          size="lg"
          disabled={!canRegister}
          loading={busy}
          onClick={register}
          className={plan.kind === "extra" ? "!bg-emerald-600 hover:!bg-emerald-700" : ""}
        >
          {plan.kind === "earlier" ? (
            <CheckCircle2 size={17} />
          ) : plan.kind === "extra" ? (
            <Zap size={17} />
          ) : (
            <LogOut size={17} />
          )}
          Registrar saída sugerida
        </Button>
      </div>

      {closed && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Jornada de {formatMinutes(day.workedMinutes)} já encerrada — saldo do dia:{" "}
          <b className={day.balanceMinutes >= 0 ? "text-emerald-600" : "text-rose-600"}>
            {day.balanceMinutes >= 0 ? "+" : ""}
            {formatMinutes(day.balanceMinutes)}
          </b>
        </p>
      )}
    </Card>
  );
}
