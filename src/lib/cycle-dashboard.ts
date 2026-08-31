/**
 * 4D (PARTES B/C/G) — SITUAÇÃO DO CICLO ANUAL (helper PURO).
 *
 * SALDO FACTUAL DO CICLO (Parte B):
 *  - intervalo = ciclo anual canônico 01/05 → 30/04 (annualCycleBounds);
 *  - MESMA contribuição factual validada do Resumo (Σ balanceContribution —
 *    companyBalanceContribution/dayBalanceContribution por dia);
 *  - somente dias realizados; futuro/congelado contribui 0 (corte temporal
 *    central); abonos/feriados/folgas via companyDayContext;
 *  - [10+] NÃO entra; plano/reserva NÃO entra; obrigação futura de
 *    calendário NÃO entra (ela vive na previsão — calendar-forecast);
 *  - isolamento absoluto em 30/04.
 *
 * SALDO PROJETADO DO CICLO (Parte C):
 *  - factual + [10+] JÁ APLICADO — a MESMA official-projection (3A)
 *    do Resumo, com need-cap por dia de destino (nenhuma hora extra
 *    artificial); somente usos ATIVOS; reserva futura NÃO entra.
 *
 * NENHUMA matemática nova: a agregação delega ao motor canônico
 * projectRealizedPeriodOfficial (o mesmo de buildResumoPeriodView).
 */
import { projectRealizedPeriodOfficial, type RealizedPeriodOfficialProjection } from "./official-projection";
import { annualCycleBounds, getAnnualPointCycle } from "./periods";
import type { CompanyCalendars } from "./company-calendar";
import type { Absence } from "./absences";
import type { Falta, TimeEntry, WorkSettings } from "./types";
import type { SpecialExcessUse } from "./special-excess-use";

export interface CycleSituation {
  /** Ex.: "2026/2027" — derivado do ciclo real, nunca hardcoded. */
  cycle: string;
  from: string;
  to: string;
  /** Parte B — saldo factual do ciclo (sem [10+]). */
  factualBalanceMinutes: number;
  /** Parte C — saldo projetado do ciclo (com [10+] já aplicado). */
  projectedBalanceMinutes: number;
  /** [10+] efetivamente aplicado no ciclo (limitado pela necessidade). */
  appliedSpecialMinutes: number;
  /** Projeção completa do motor (para reuso/auditoria). */
  official: RealizedPeriodOfficialProjection;
}

/** [10+] ativo agregado por DESTINO — a MESMA preparação do Resumo (3A). */
function usedActiveByDate(uses: SpecialExcessUse[]): Record<string, number> {
  const byDate: Record<string, number> = {};
  for (const u of uses) {
    if (u.status !== "utilizado") continue;
    const total = u.allocations.reduce((s, a) => s + a.minutes, 0);
    byDate[u.destinationDate] = (byDate[u.destinationDate] ?? 0) + total;
  }
  return byDate;
}

export function buildCycleSituation(p: {
  today: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate?: string | null;
  uses?: SpecialExcessUse[];
}): CycleSituation {
  const cycle = getAnnualPointCycle(p.today);
  const { from, to } = annualCycleBounds(cycle);
  const official = projectRealizedPeriodOfficial({
    from,
    to,
    today: p.today,
    entries: p.entries,
    absences: p.absences,
    calendars: p.calendars,
    settings: p.settings,
    faltas: p.faltas,
    controlStartDate: p.controlStartDate ?? null,
    usedSpecialMinutesByDate: usedActiveByDate(p.uses ?? []),
  });
  return {
    cycle,
    from,
    to,
    factualBalanceMinutes: official.factualBalanceMinutes,
    projectedBalanceMinutes: official.projectedBalanceMinutes,
    appliedSpecialMinutes: official.appliedSpecialMinutes,
    official,
  };
}
