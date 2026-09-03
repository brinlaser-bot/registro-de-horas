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
import type { SpecialExcessPlan } from "./special-excess-plan";
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
  /**
   * 4A — Planos/reservas ativas. O painel do banco exibe "Disponível":
   * DISPONÍVEL = GERADO − UTILIZADO ATIVO − RESERVADO ATIVO. Opcional:
   * chamadas antigas sem o campo comportam-se como antes (reserved 0).
   * O card "[10+] gerado no período" continua geração FACTUAL (sem descontar).
   */
  plans?: SpecialExcessPlan[];
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
  const { period, today, entries, absences, calendars, settings, faltas, controlStartDate, uses, plans = [] } = input;
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
      plans, // 4A: painel "Disponível" líquida reservas ativas
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

/* ════════════════════════════════════════════════════════════════════
 * 4F — AGREGADOS DO RESUMO DO PERÍODO (derivados puros/reutilizáveis).
 * Nenhuma matemática nova: cada agregado é um recorte de PERÍODO sobre
 * fontes canônicas já consolidadas (attention-now, banco [10+],
 * SpecialExcessUse/Plan, central-view/companyDayContext).
 * ════════════════════════════════════════════════════════════════════ */

import { attentionNowSummary } from "./attention-now";
import { centralCalendarEvents, centralCalendarSummary, type CentralCalendarEventRow } from "./central-view";

/** Pendências de APURAÇÃO do período (4F): MESMO classificador canônico da
 *  atenção agora (4D.5), recortado no período 21→20 via `range`. Só categorias
 *  que tornam a leitura incompleta; futuro/hoje em andamento/ABONADO neutro/
 *  fim de semana comum NUNCA aparecem (regra do classificador). */
export interface ResumoPeriodPendencies {
  inconsistente: string[];
  incompleto: string[];
  semRegistro: string[];
  /** Planejamento [10+] que CHEGOU AO DIA e aguarda decisão — destino no período. */
  plano10: string[];
  total: number;
}

export function resumoPeriodPendencies(input: {
  today: string;
  period: PointPeriod;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
  plans: SpecialExcessPlan[];
}): ResumoPeriodPendencies {
  const s = attentionNowSummary({
    today: input.today,
    entries: input.entries,
    absences: input.absences,
    calendars: input.calendars,
    settings: input.settings,
    faltas: input.faltas,
    controlStartDate: input.controlStartDate,
    plans: input.plans,
    range: { from: input.period.from, to: input.period.to },
  });
  return {
    inconsistente: s.inconsistente,
    incompleto: s.incompleto,
    semRegistro: s["sem-registro"],
    plano10: s["plano-10"],
    total: s.inconsistente.length + s.incompleto.length + s["sem-registro"].length + s["plano-10"].length,
  };
}

/** MOVIMENTAÇÃO [10+] DO PERÍODO (4F): origens/destinos dentro do período
 *  21→20 — ≠ saldo total do banco do ciclo (esse é da Central). Contagens
 *  lidas de buildSpecialExcessBank (lots), SpecialExcessUse ativo e planos
 *  planned; nenhuma nova matemática. */
export interface ResumoSpecialPeriodMovement {
  /** [10+] nascido em origens DENTRO do período. */
  generatedMinutes: number;
  /** [10+] aplicado em destinos DENTRO do período (usos ativos). */
  usedMinutes: number;
  /** Reservas `planned` com destino DENTRO do período. */
  reservedMinutes: number;
  /** Algum uso do período consome origem de OUTRO período do mesmo ciclo
   *  (válido — o texto informativo da UI deriva daqui). */
  usesOriginOutsidePeriod: boolean;
  usesWithDestination: number;
}

export function resumoSpecialPeriodMovement(input: {
  period: PointPeriod;
  today: string;
  cycle: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
  uses: SpecialExcessUse[];
  plans: SpecialExcessPlan[];
}): ResumoSpecialPeriodMovement {
  const { period } = input;
  const inPeriod = (d: string) => d >= period.from && d <= period.to;
  const bank = buildSpecialExcessBank({
    cycle: input.cycle,
    asOfDate: input.today,
    entries: input.entries,
    absences: input.absences,
    calendars: input.calendars,
    settings: input.settings,
    faltas: input.faltas,
    controlStartDate: input.controlStartDate ?? "",
    uses: input.uses,
    plans: input.plans,
  });
  const generatedMinutes = bank.lots
    .filter((l) => inPeriod(l.originDate))
    .reduce((s, l) => s + l.generatedMinutes, 0);
  let usedMinutes = 0;
  let reservedMinutes = 0;
  let usesWithDestination = 0;
  let usesOriginOutsidePeriod = false;
  for (const u of input.uses) {
    if (u.status !== "utilizado" || !inPeriod(u.destinationDate)) continue;
    usesWithDestination += 1;
    usedMinutes += u.allocations.reduce((s, a) => s + a.minutes, 0);
    if (u.allocations.some((a) => a.originDate < period.from)) usesOriginOutsidePeriod = true;
  }
  for (const p of input.plans) {
    if (p.status !== "planned" || !inPeriod(p.destinationDate)) continue;
    reservedMinutes += p.allocations.reduce((s, a) => s + a.minutes, 0);
  }
  return { generatedMinutes, usedMinutes, reservedMinutes, usesOriginOutsidePeriod, usesWithDestination };
}

/** Calendário da empresa NO PERÍODO (4F): MESMA derivação canônica da Central
 *  (centralCalendarEvents — forecast para futuro, companyDayContext +
 *  dayBalanceContribution para realizado), recortada em 21→20. Sem nova
 *  matemática; classificação integral×parcial (4E.1) preservada. */
export function resumoCalendarPeriodRows(input: {
  today: string;
  cycle: string;
  period: PointPeriod;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate: string | null;
}): { hasCalendar: boolean; label: string | null; realized: CentralCalendarEventRow[]; future: CentralCalendarEventRow[] } {
  const summary = centralCalendarSummary(input.calendars, input.cycle);
  if (!summary.hasCalendar) {
    return { hasCalendar: false, label: null, realized: [], future: [] };
  }
  const evs = centralCalendarEvents({
    today: input.today,
    cycle: input.cycle,
    entries: input.entries,
    absences: input.absences,
    calendars: input.calendars,
    settings: input.settings,
    faltas: input.faltas,
    controlStartDate: input.controlStartDate,
  });
  const inPeriod = (r: CentralCalendarEventRow) => r.date >= input.period.from && r.date <= input.period.to;
  return {
    hasCalendar: true,
    label: summary.label,
    realized: evs.past.filter(inPeriod),
    future: evs.future.filter(inPeriod),
  };
}

/** Projeção agrega informação? (usos aplicados > 0). Caso contrário: discreta. */
export function resumoProjectionVisible(r: ResumoDetailRow): boolean {
  return r.projection.projectable && r.projection.appliedSpecialMinutes > 0;
}
