// DERIVAÇÃO PURA E ÚNICA do Resumo do período (Etapa 3F).
//
// Cards principais, composição do saldo regular, banco anual [10+] e as
// linhas do detalhamento (mesma fonte para tabela desktop, cards mobile e
// CSV) derivam daqui — sem cálculo duplicado na UI.
//
// FONTES: FATOS (resumo-days, central) + 2A (regular-facts) + 3A
// (official-projection) + 3B/3D (SpecialExcessUse) + 3C (special-excess-bank).
// NÃO depende dos motores legados de dívida/cobertura/déficit aberto nem de
// compensações (legado preservado fora da experiência principal do Resumo).
import {
  buildResumoDayRow,
  isQuietResumoDay,
  resumoEventKind,
  resumoFinancialFrozen,
  type ResumoDayRow,
} from "./resumo-days";
import { summarizeRegularFacts, type RegularFacts } from "./regular-facts";
import {
  projectRealizedPeriodOfficial,
  type RealizedDayOfficialProjection,
  type RealizedPeriodOfficialProjection,
} from "./official-projection";
import { buildSpecialExcessBank, type SpecialExcessBankSummary } from "./special-excess-bank";
import { getAnnualPointCycle, listDaysBetween, type PointPeriod } from "./periods";
import { isRealizedDate } from "./time";
import type { SpecialExcessUse } from "./special-excess-use";
import type { CompanyCalendars } from "./company-calendar";
import type { Absence } from "./absences";
import type { Falta, TimeEntry, WorkSettings } from "./types";

export interface ResumoPeriodViewInput {
  /** Período de ponto já resolvido pelo helper central (21→20). */
  period: PointPeriod;
  /** Corte temporal civil (hoje). Injetável para testes. */
  today: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
  /** Registros de uso [10+] (3B) — insumo histórico; nunca mutados. */
  uses: SpecialExcessUse[];
}

/** Linha do detalhamento diário — alimenta tabela desktop, cards mobile e CSV. */
export interface ResumoDetailRow {
  day: ResumoDayRow;
  /** Rótulo da situação (coluna Evento / badge). */
  situation: string;
  /** 3C: [10+] gerado neste dia (lote do ciclo do dia; 0 quando não gerou). */
  specialGenerated: number;
  /** 3B/3D: [10+] ATIVAMENTE utilizado neste dia como destino. */
  specialUsed: number;
  /** 3A: projeção oficial do dia (identidade quando não aplicável). */
  projection: RealizedDayOfficialProjection;
}

/** Painel de banco anual — UM por ciclo anual intersectado pelo período. */
export interface ResumoBankPanel {
  cycle: string;
  bank: SpecialExcessBankSummary;
}

export interface ResumoPeriodView {
  period: PointPeriod;
  /** Linhas do detalhamento (ordem cronológica; dias quietos já filtrados). */
  days: ResumoDetailRow[];
  cards: {
    /** A) Horas registradas — Σ trabalhado dos dias realizados (fato registrado,
     *  incluindo horas conhecidas de dias pendentes). Não é total financeiro. */
    registeredMinutes: number;
    /** B) Saldo regular factual do período — INDEPENDENTE do uso de [10+]. */
    regularBalanceMinutes: number;
    /** C) [10+] gerado no PERÍODO (origem dentro do período; ≠ banco do ciclo). */
    specialGeneratedMinutes: number;
    /** D) Projeção no ponto (3A) — factual + Σ usos ativos aplicáveis. */
    projection: RealizedPeriodOfficialProjection;
    /** true quando há dia pendente (incompleto/inconsistente) com batidas. */
    hasPendingRegisteredDays: boolean;
  };
  /** Composição do saldo regular (2A): créditos / déficits / líquido. */
  composition: RegularFacts;
  /** Bancos anuais [10+] (3C) — um painel por ciclo; período que cruza 30/04
   *  gera painéis separados (NUNCA um banco único atravessando o fechamento). */
  banks: ResumoBankPanel[];
  totals: {
    /** Dias com batidas realizadas no período. */
    trackedDays: number;
    /** No ponto totalizado SOMENTE dos dias financeiramente válidos. */
    noPontoValidMinutes: number;
    /** [10+] gerado no período (== cards.specialGeneratedMinutes). */
    specialGeneratedMinutes: number;
    /** [10+] utilizado (ativo) com destino no período. */
    specialUsedMinutes: number;
  };
}

export function buildResumoPeriodView(input: ResumoPeriodViewInput): ResumoPeriodView {
  const { period, today, entries, absences, calendars, settings, faltas, controlStartDate, uses } = input;
  const allDates = listDaysBetween(period.from, period.to);

  // 1) FATOS por dia — fonte central do Resumo (mesma da 2A/3A).
  const rows = allDates
    .map((date) =>
      buildResumoDayRow({
        date,
        today,
        entries,
        absences,
        calendars,
        settings,
        faltas,
        controlStartDate,
      }),
    )
    .filter(isQuietResumoDay);

  // 2) BANCO ANUAL [10+] (3C) — UM painel por ciclo anual intersectado.
  const cycles = [...new Set(allDates.map(getAnnualPointCycle))].sort();
  const banks: ResumoBankPanel[] = cycles.map((cycle) => ({
    cycle,
    bank: buildSpecialExcessBank({
      cycle,
      asOfDate: today,
      entries,
      absences,
      calendars,
      settings,
      faltas,
      controlStartDate: controlStartDate ?? "",
      uses,
    }),
  }));
  const generatedByDate = new Map<string, number>();
  for (const { bank } of banks) {
    for (const lot of bank.lots) {
      if (lot.generatedMinutes > 0) generatedByDate.set(lot.originDate, lot.generatedMinutes);
    }
  }

  // 3) [10+] UTILIZADO (3B/3D) — usos ATIVOS agregados por DESTINO.
  const usedByDate: Record<string, number> = {};
  for (const u of uses) {
    if (u.status !== "utilizado") continue;
    const total = u.allocations.reduce((s, a) => s + a.minutes, 0);
    usedByDate[u.destinationDate] = (usedByDate[u.destinationDate] ?? 0) + total;
  }

  // 4) PROJEÇÃO OFICIAL (3A) — período + dia a dia (usa 3).
  const projection = projectRealizedPeriodOfficial({
    from: period.from,
    to: period.to,
    today,
    entries,
    absences,
    calendars,
    settings,
    faltas,
    controlStartDate,
    usedSpecialMinutesByDate: usedByDate,
  });
  const projectionByDate = new Map(projection.days.map((d) => [d.date, d]));

  // 5) COMPOSIÇÃO DO SALDO REGULAR (2A) — créditos/déficits/líquido.
  const composition = summarizeRegularFacts({
    from: period.from,
    to: period.to,
    today,
    entries,
    absences,
    calendars,
    settings,
    faltas,
    controlStartDate,
  });

  // 6) Linhas do detalhamento (MESMA fonte para desktop/mobile/CSV).
  const days: ResumoDetailRow[] = rows.map((day) => ({
    day,
    situation: resumoEventKind(day),
    specialGenerated: generatedByDate.get(day.date) ?? 0,
    specialUsed: usedByDate[day.date] ?? 0,
    projection: projectionByDate.get(day.date) ?? {
      date: day.date,
      projectable: false,
      reason: "not-realized",
      factualWorkedMinutes: day.workedMinutes,
      factualRegistrableMinutes: day.registrableMinutes,
      factualRegularBalanceMinutes: day.balanceContribution,
      neededToBaseMinutes: 0,
      appliedSpecialMinutes: 0,
      excessUsedMinutes: 0,
      needsReview: false,
      projectedWorkedMinutes: day.registrableMinutes,
      projectedBalanceMinutes: day.balanceContribution,
    },
  }));

  const registeredMinutes = rows.reduce((s, d) => s + d.workedMinutes, 0);
  const regularBalanceMinutes = rows.reduce((s, d) => s + d.balanceContribution, 0);
  const specialGeneratedMinutes = days.reduce((s, r) => s + r.specialGenerated, 0);
  const specialUsedMinutes = days.reduce((s, r) => s + r.specialUsed, 0);
  const hasPendingRegisteredDays = days.some(
    (r) => r.day.entryCount > 0 && (r.day.status === "incomplete" || r.day.status === "inconsistent"),
  );

  return {
    period,
    days,
    cards: {
      registeredMinutes,
      regularBalanceMinutes,
      specialGeneratedMinutes,
      projection,
      hasPendingRegisteredDays,
    },
    composition,
    banks,
    totals: {
      trackedDays: rows.filter((d) => d.entryCount > 0 && isRealizedDate(d.date, today)).length,
      noPontoValidMinutes: rows.reduce(
        (s, d) => s + (resumoFinancialFrozen(d) || d.entryCount <= 0 ? 0 : d.registrableMinutes),
        0,
      ),
      specialGeneratedMinutes,
      specialUsedMinutes,
    },
  };
}

/** true quando o dia tem registro pendente (incompleto/inconsistente) com batidas. */
export function resumoDayPending(r: ResumoDetailRow): boolean {
  return r.day.entryCount > 0 && (r.day.status === "incomplete" || r.day.status === "inconsistent");
}

/** Projeção agrega informação? (usos aplicados > 0). Caso contrário: discreta. */
export function resumoProjectionVisible(r: ResumoDetailRow): boolean {
  return r.projection.projectable && r.projection.appliedSpecialMinutes > 0;
}
