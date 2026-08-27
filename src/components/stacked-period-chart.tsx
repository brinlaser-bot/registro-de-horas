"use client";

/**
 * "Barras empilhadas do período" — preparação + componente COMPARTILHADOS
 * entre o Resumo do período (versão completa, height 210) e a Visão geral
 * (versão compacta, height 150). Extração puramente visual (UX): nenhuma
 * fórmula vive aqui — os valores vêm das mesmas funções centrais usadas
 * pelo Resumo (companyDayContext / buildDebtDays / stackedSegments /
 * appliedOnDate), garantindo dados idênticos para o mesmo período.
 */
import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { expectedMinutesOf, formatMinutes, isRealizedDate, isWeekend, stackedSegments, todayString } from "@/lib/time";
import { absenceLabel, absenceOnDate, type Absence } from "@/lib/absences";
import { acordoViewOf, appliedOnDate, buildDebtDays, pendingForTarget, type AcordoView } from "@/lib/debt";
import { companyDayContext, type CompanyCalendars } from "@/lib/company-calendar";
import { faltaOnDate } from "@/lib/faltas";
import { listDaysBetween, type PointPeriod } from "@/lib/periods";
import type { Compensation, Falta, TimeEntry, WorkSettings } from "@/lib/types";
import { StackedBarsChart, type ChartAbsenceMarker, type StackedDatum } from "@/components/charts";
import { EmptyState } from "@/components/ui";

/** Marcador visual do dia (férias/afastamentos) — apenas informativo. */
function markerOf(a: Absence): ChartAbsenceMarker {
  if (a.kind === "ferias") return "ferias";
  if (a.kind === "saude") return "saude";
  if (a.kind === "acordado") {
    return a.treatment === "compensar" ? "acordado-compensar" : "acordado-dispensado";
  }
  if (a.kind === "abono") return "abono-aniversario";
  return "outro";
}

export interface StackedPeriodParams {
  entries: TimeEntry[];
  compensations: Compensation[];
  absences?: Absence[];
  companyCalendars?: CompanyCalendars;
  settings: WorkSettings;
  /** Período de ponto JÁ resolvido pelo helper central (21→20, com os especiais do fechamento anual). */
  period: PointPeriod;
  /** Faltas registradas (marcador informativo; efetiva = data <= hoje). */
  faltas?: Falta[];
  /** Data local de hoje (yyyy-mm-dd) — resolve a falta efetiva sem depender do relógio do teste. */
  today?: string;
}

/**
 * Preparação ÚNICA do gráfico (base · extra no ponto · excedente · compensado),
 * idêntica à do Resumo do período. O marcador de férias/afastamento é somente
 * informativo — não soma horas à barra.
 */
export function buildStackedPeriodData({
  entries,
  compensations,
  absences = [],
  companyCalendars,
  settings,
  period,
  faltas = [],
  today,
}: StackedPeriodParams): StackedDatum[] {
  const todayStr = today ?? todayString();
  // Visão central dos acordos do período (original/compensado/planejado/restante)
  const acordoByDate = new Map<string, AcordoView>();
  for (const d of buildDebtDays(entries, compensations, settings, period, absences, companyCalendars)) {
    if (d.kind === "acordo") acordoByDate.set(d.date, acordoViewOf(d));
  }

  return listDaysBetween(period.from, period.to)
    .map((date) => {
      const cctx = companyDayContext(date, entries, absences, companyCalendars, settings);
      const ctx = cctx.ctx;
      const absence = absenceOnDate(absences, date);
      // Falta só ganha marcador quando EFETIVA (data <= hoje); prevista não contamina.
      const faltaEf = (() => {
        const f = faltaOnDate(faltas, date);
        return f && f.date <= todayStr ? f : undefined;
      })();
      const eventLabel =
        cctx.label ??
        (absence ? absenceLabel(absence) : null) ??
        (faltaEf ? "Falta" : null);
      return { date, cctx, ctx, absence, eventLabel, faltaEf };
    })
    .filter((d) => d.ctx.day.entries.length > 0 || d.eventLabel || d.faltaEf || !isWeekend(d.date))
    .map((d) => {
      const realized = isRealizedDate(d.date, todayStr);
      const idleToday =
        d.date === todayStr &&
        d.ctx.day.empty &&
        !d.faltaEf &&
        !d.absence &&
        d.cctx.effectiveExpected > 0;
      const worked = realized ? d.ctx.day.workedMinutes : 0;
      const expected = d.cctx.expectedRegular;
      const seg = stackedSegments(worked, expected, settings.maxDailyMinutes);
      const used = appliedOnDate(compensations, d.date);
      const pendingMins = pendingForTarget(compensations, d.date).reduce((s, c) => s + c.minutes, 0);
      const concludedMins = Math.max(0, used - pendingMins);
      const acordo = acordoByDate.get(d.date) ?? null;
      const predictedWorked = !realized && d.ctx.day.entries.length > 0 ? d.ctx.day.workedMinutes : 0;

      const lines: string[] = [];
      if (!realized) {
        lines.push(predictedWorked > 0 ? `Registro futuro · previsto ${formatMinutes(predictedWorked)}` : "Registro futuro");
      } else if (idleToday) {
        lines.push("Jornada não iniciada");
      }
      if (d.absence) {
        lines.push(
          d.absence.duration === "parcial"
            ? `Período: ${d.absence.partialStart}–${d.absence.partialEnd}`
            : "Dia integral",
        );
        if (d.absence.kind === "saude") {
          lines.push(
            d.absence.medicalCert ? "Atestado apresentado" : "Atestado não apresentado",
          );
        }
        if (d.absence.kind === "abono") {
          lines.push("Jornada 0h · saldo neutro (não gera crédito nem déficit)");
        }
      } else if (d.faltaEf) {
        lines.push(
          `Jornada do dia: ${formatMinutes(d.cctx.effectiveExpected)} — déficit integral`,
        );
      } else if (d.eventLabel) {
        lines.push(d.eventLabel);
      }
      if (acordo && acordo.originalMinutes > 0) {
        lines.push(
          `Acordo original: ${formatMinutes(acordo.originalMinutes)}`,
          `Compensado: ${formatMinutes(acordo.compensatedMinutes)}`,
        );
        if (acordo.plannedMinutes > 0) {
          lines.push(`Planejado: ${formatMinutes(acordo.plannedMinutes)}`);
        }
        lines.push(`Restante: ${formatMinutes(acordo.remainingMinutes)}`);
      }

      return {
        date: d.date,
        label: d.date.slice(8),
        workedMinutes: worked,
        expectedMinutes: expected,
        base: seg.base,
        extra: seg.extra,
        excess: seg.excess,
        compensated: Math.max(0, Math.min(used, Math.max(0, expected - worked))),
        compensatedConcluded: concludedMins,
        compensatedPending: pendingMins,
        marker: d.absence
          ? markerOf(d.absence)
          : d.faltaEf
            ? "falta"
            : d.cctx.marker === "abono-parcial"
              ? "abono"
              : d.cctx.marker ?? undefined,
        markerLabel: d.eventLabel ?? undefined,
        markerLines: lines.length > 0 ? lines : undefined,
        // Futuro e HOJE idle: tooltip neutro — nunca saldo −8h.
        regularBalance: !realized || idleToday ? undefined : d.cctx.regularBalance,
        tooltipTone: !realized ? "future" : idleToday ? "idle" : "factual",
        predictedWorked: predictedWorked > 0 ? predictedWorked : undefined,
      };
    });
}

/** Gráfico empilhado do período — semântica idêntica no Resumo e na Visão geral; muda apenas o tamanho. */
export function StackedPeriodChart({
  entries,
  compensations,
  absences = [],
  companyCalendars,
  settings,
  period,
  faltas = [],
  today,
  height = 210,
}: StackedPeriodParams & { height?: number }) {
  const data = useMemo(
    () => buildStackedPeriodData({ entries, compensations, absences, companyCalendars, settings, period, faltas, today }),
    [entries, compensations, absences, companyCalendars, settings, period, faltas, today],
  );
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={24} />}
        title="Sem dados neste período"
        description="Registre seus horários para ver o gráfico e o resumo."
      />
    );
  }
  return (
    <StackedBarsChart
      data={data}
      expected={expectedMinutesOf(settings)}
      cap={settings.maxDailyMinutes}
      height={height}
    />
  );
}
