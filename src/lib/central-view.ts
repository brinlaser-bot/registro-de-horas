// ─────────────────────────────────────────────────────────────
// VIEW-MODEL DA CENTRAL DE HORAS (4E) — GESTÃO DETALHADA +
// RASTREABILIDADE CANÔNICA. A página apenas RENDERIZA este
// view-model: nenhuma matemática nova na page.
//
// Fontes canônicas (uma por bloco — nenhuma 2ª matemática):
//   · Banco [10+]  → buildSpecialExcessBank (lots/destinations);
//   · Motivo       → excessReasonOnDate;
//   · Reservas/Usos → SpecialExcessPlan/Use + allocations;
//   · Calendário   → CompanyCalendar.entries (Σ cadastradas),
//                    buildCalendarForecast (impacto futuro),
//                    companyDayContext + dayBalanceContribution
//                    (efeito factual de eventos realizados).
//
// SEMÂNTICA 4D.4 (crítica): evento COMPENSAR já realizado tem seu
// efeito NO saldo factual — nunca é reapresentado como dívida
// adicional. Futuro não realizado aparece apenas como impacto
// conhecido (PREVISÃO), rotulado como tal.
// ─────────────────────────────────────────────────────────────
import { annualCycleBounds, getAnnualPointCycle, listDaysBetween } from "./periods";
import { buildCalendarForecast } from "./calendar-forecast";
import { companyDayContext, entryOnDate, type CalendarTreatment, type CompanyCalendars } from "./company-calendar";
import { dayBalanceContribution } from "./faltas";
import type { Absence } from "./absences";
import type { Falta, TimeEntry, WorkSettings } from "./types";
import type { CompanyCalendar } from "./company-calendar";

/** Σ das cargas CADASTRADAS do calendário do ciclo (configuração original —
 *  NÃO é "dívida atual"). Carga COMPENSAR = Σ horasACompensar dos eventos
 *  COMPENSAR; ABONADAS = Σ horasAbonadas dos eventos com abono. */
export function centralCalendarSummary(cals: CompanyCalendars | undefined, cycle: string): {
  hasCalendar: boolean;
  label: string | null;
  dateCount: number;
  compLoadMinutes: number;
  abonadasMinutes: number;
} {
  const cal: CompanyCalendar | undefined = cals?.find(
    (c) => c.cycleStart === annualCycleBounds(cycle).from || c.cycleLabel?.replace("–", "/") === cycle,
  ) ?? cals?.[0];
  if (!cal) {
    return { hasCalendar: false, label: null, dateCount: 0, compLoadMinutes: 0, abonadasMinutes: 0 };
  }
  const { from, to } = annualCycleBounds(cycle);
  const entries = cal.entries.filter((e) => e.date >= from && e.date <= to);
  const compLoadMinutes = entries
    .filter((e) => e.tratamento === "COMPENSAR")
    .reduce((s, e) => s + Math.max(0, e.horasACompensar) * 60, 0);
  const abonadasMinutes = entries
    .filter((e) => e.tratamento === "ABONADO" || e.tratamento === "ABONADO_PARCIAL")
    .reduce((s, e) => s + Math.max(0, e.horasAbonadas) * 60, 0);
  return {
    hasCalendar: true,
    label: cal.cycleLabel ?? null,
    dateCount: entries.length,
    compLoadMinutes,
    abonadasMinutes,
  };
}

/** Linha de um evento do calendário (futuro ou realizado) — campos lidos da
 *  resolução central companyDayContext; impacto futuro conhecido somente do
 *  buildCalendarForecast (nunca inferido aqui). */
export interface CentralCalendarEventRow {
  date: string;
  descricao: string;
  categoria: string;
  tratamento: CalendarTreatment;
  baseReferenciaMinutes: number;
  creditoCalendarioMinutes: number;
  jornadaACumprirMinutes: number;
  /** COMPENSAR com crédito de calendário + jornada menor que a base (ex.:
   *  Cinzas 4h+4h) — JORNADA PARCIAL: nunca "folga integral" nem impacto
   *  futuro automático. Derivado do contexto canônico (companyDayContext). */
  jornadaParcial?: boolean;
  /** Só para eventos futuros/hoje-pendente que o forecast expõe (≤ 0). */
  impactoFuturoConhecidoMinutes: number | null;
  /** Só para eventos realizados: fato do dia. */
  trabalhadoMinutes?: number;
  saldoFactualMinutes?: number;
  /** 4D.4.1: ABONADO realizado com batidas — observação de política pendente. */
  trabalhoEmAbonado?: boolean;
  /** Evento explícito anterior ao início do controle: permanece fato conhecido. */
  preControlStartDate?: boolean;
}

const TREATMENT_LABEL: Record<string, string> = {
  COMPENSAR: "COMPENSAR",
  ABONADO: "ABONADO",
  ABONADO_PARCIAL: "ABONADO parcial",
};

export function tratamentoLabel(t: CalendarTreatment): string {
  return TREATMENT_LABEL[t] ?? t;
}

/** Próximos eventos (crescente) + eventos realizados (mais recente primeiro)
 *  do ciclo. Nenhuma dupla contagem: impacto conhecido vem do forecast;
 *  efeito factual de realizado vem de dayBalanceContribution. */
export function centralCalendarEvents(opts: {
  today: string;
  cycle: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas?: Falta[];
  controlStartDate?: string | null;
}): { future: CentralCalendarEventRow[]; past: CentralCalendarEventRow[] } {
  const { from, to } = annualCycleBounds(opts.cycle);
  const forecast = buildCalendarForecast({
    calendars: opts.calendars,
    cycle: opts.cycle,
    today: opts.today,
    entries: opts.entries,
    absences: opts.absences,
    settings: opts.settings,
  });
  const impactoPorData = new Map(forecast.events.map((e) => [e.date, e.impactMinutes]));

  /** Classificação de apresentação (4E.1) lida do contexto canônico: folga
   *  INTEGRAL (crédito 0, jornada a cumprir = base) × JORNADA PARCIAL
   *  (crédito > 0 e jornada a cumprir < base — ex.: Cinzas 4h+4h). Nenhuma
   *  matemática nova: apenas comparação entre campos de companyDayContext. */
  const jornadaParcialDe = (tratamento: CalendarTreatment, cctx: ReturnType<typeof companyDayContext>): boolean =>
    tratamento === "COMPENSAR" &&
    cctx.calendarCreditMinutes > 0 &&
    cctx.requiredWorkMinutes > 0 &&
    cctx.requiredWorkMinutes < cctx.referenceBaseMinutes;

  const future: CentralCalendarEventRow[] = [];
  const past: CentralCalendarEventRow[] = [];
  for (const date of listDaysBetween(from, to)) {
    const entry = entryOnDate(opts.calendars, date);
    if (!entry) continue;
    if (date > opts.today) {
      // Futuro: o mesmo contexto canônico do realizado resolve a APRESENTAÇÃO
      // (base referência / crédito calendário / jornada a cumprir) — o efeito
      // factual continua sendo só o do forecast (impacto conhecido, previsão).
      const cctx = companyDayContext(date, opts.entries, opts.absences, opts.calendars, opts.settings);
      future.push({
        date,
        descricao: entry.descricao,
        categoria: entry.categoria,
        tratamento: entry.tratamento,
        baseReferenciaMinutes: cctx.referenceBaseMinutes,
        creditoCalendarioMinutes: cctx.calendarCreditMinutes,
        jornadaACumprirMinutes: cctx.requiredWorkMinutes,
        jornadaParcial: jornadaParcialDe(entry.tratamento, cctx),
        impactoFuturoConhecidoMinutes: impactoPorData.get(date) ?? null,
      });
      continue;
    }
    // Realizado/hoje: verdade lida da resolução central (nunca inferida):
    const cctx = companyDayContext(date, opts.entries, opts.absences, opts.calendars, opts.settings);
    past.push({
      date,
      descricao: entry.descricao,
      categoria: entry.categoria,
      tratamento: entry.tratamento,
      baseReferenciaMinutes: cctx.referenceBaseMinutes,
      creditoCalendarioMinutes: cctx.calendarCreditMinutes,
      jornadaACumprirMinutes: cctx.requiredWorkMinutes,
      jornadaParcial: jornadaParcialDe(entry.tratamento, cctx),
      impactoFuturoConhecidoMinutes: null,
      trabalhadoMinutes: cctx.ctx.day.workedMinutes,
      saldoFactualMinutes: dayBalanceContribution(cctx, opts.faltas ?? [], date, opts.today),
      trabalhoEmAbonado: (entry.tratamento === "ABONADO" || entry.tratamento === "ABONADO_PARCIAL") && cctx.ctx.day.workedMinutes > 0,
      preControlStartDate: !!opts.controlStartDate && date < opts.controlStartDate,
    });
  }
  future.sort((a, b) => a.date.localeCompare(b.date));
  past.sort((a, b) => b.date.localeCompare(a.date));
  return { future, past };
}

/** Ciclos presentes nos dados (sem persistência): o ciclo atual + os ciclos
 *  de calendários importados + ciclos com planos/usos/origens. */
export function centralCycles(opts: {
  today: string;
  calendars?: { cycleStart: string; cycleLabel?: string }[];
  planDates?: string[];
  useDates?: string[];
  originDates?: string[];
}): string[] {
  const set = new Set<string>([getAnnualPointCycle(opts.today)]);
  for (const c of opts.calendars ?? []) set.add(getAnnualPointCycle(c.cycleStart));
  for (const d of opts.planDates ?? []) set.add(getAnnualPointCycle(d));
  for (const d of opts.useDates ?? []) set.add(getAnnualPointCycle(d));
  for (const d of opts.originDates ?? []) set.add(getAnnualPointCycle(d));
  return [...set].sort();
}
