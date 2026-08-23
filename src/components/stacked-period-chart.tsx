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
import { expectedMinutesOf, formatMinutes, isWeekend, stackedSegments } from "@/lib/time";
import { absenceLabel, absenceOnDate, type Absence } from "@/lib/absences";
import { acordoViewOf, appliedOnDate, buildDebtDays, type AcordoView } from "@/lib/debt";
import { companyDayContext, type CompanyCalendars } from "@/lib/company-calendar";
import { listDaysBetween, type PointPeriod } from "@/lib/periods";
import type { Compensation, TimeEntry, WorkSettings } from "@/lib/types";
import { StackedBarsChart, type ChartAbsenceMarker, type StackedDatum } from "@/components/charts";
import { EmptyState } from "@/components/ui";

/** Marcador visual do dia (férias/afastamentos) — apenas informativo. */
function markerOf(a: Absence): ChartAbsenceMarker {
  if (a.kind === "ferias") return "ferias";
  if (a.kind === "saude") return "saude";
  if (a.kind === "acordado") {
    return a.treatment === "compensar" ? "acordado-compensar" : "acordado-dispensado";
  }
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
}: StackedPeriodParams): StackedDatum[] {
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
      const eventLabel = cctx.label ?? (absence ? absenceLabel(absence) : null);
      return { date, cctx, ctx, absence, eventLabel };
    })
    .filter((d) => d.ctx.day.entries.length > 0 || d.eventLabel || !isWeekend(d.date))
    .map((d) => {
      const worked = d.ctx.day.workedMinutes;
      const expected = d.cctx.expectedRegular;
      const seg = stackedSegments(worked, expected, settings.maxDailyMinutes);
      const used = appliedOnDate(compensations, d.date);
      const acordo = acordoByDate.get(d.date) ?? null;

      const lines: string[] = [];
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
        marker: d.absence ? markerOf(d.absence) : d.cctx.marker ?? undefined,
        markerLabel: d.eventLabel ?? undefined,
        markerLines: lines.length > 0 ? lines : undefined,
        regularBalance: d.cctx.regularBalance,
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
  height = 210,
}: StackedPeriodParams & { height?: number }) {
  const data = useMemo(
    () => buildStackedPeriodData({ entries, compensations, absences, companyCalendars, settings, period }),
    [entries, compensations, absences, companyCalendars, settings, period],
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
