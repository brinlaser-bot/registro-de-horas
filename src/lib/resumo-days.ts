// Classificação da tabela do Resumo — reutiliza Sem registro, isAbaixoDaBase
// e a resolução central. NÃO inventa saldo/déficit a partir de dia sem fatos.
import { absenceLabel, absenceOnDate, type Absence } from "./absences";
import { calendarEventPendingToday, companyDayContext, companyDeficitContribution, type CompanyCalendars } from "./company-calendar";
import { isAbaixoDaBase } from "./day-situation";
import { dayBalanceContribution, faltaOnDate, faltaStatusOf } from "./faltas";
import { isMissingExpectedRecord } from "./missing-records";
import { isRealizedDate, isWeekend, type WorkSettings } from "./time";
import type { Falta, TimeEntry } from "./types";

export type ResumoTableStatus =
  | "future"
  | "empty"
  | "idle"
  | "falta"
  | "ferias"
  | "afastamento"
  | "in-progress"
  | "inconsistent"
  | "incomplete"
  | "excess"
  | "deficit"
  | "ok";

export interface ResumoDayRow {
  date: string;
  workedMinutes: number;
  expectedMinutes: number;
  /** 4D.4/4D.4.2: trabalho NECESSÁRIO do dia — para dias de calendário é o
   *  conceito canônico do evento (requiredWorkMinutes; ex.: COMPENSAR integral
   *  8h · Cinzas 4h · ABONADO 0); para os demais dias é a jornada efetiva
   *  (comportamento inalterado). Fonte única da necessidade [10+] em dia
   *  realizado e da base da projeção oficial — NUNCA o gate de PLANEJAMENTO
   *  futuro da 4D.3 (effectiveExpected de evento integral = 0). */
  requiredWorkMinutes: number;
  /** 4D.4/4D.4.2: o dia tem entrada EXPLÍCITA do calendário (evento é fato
   *  suficiente quando passado — mesmo sem batidas). */
  calendarEventDay: boolean;
  /** 4D.4 (Parte G): evento do calendário em HOJE ainda sem jornada
   *  encerrada — permanece previsão (bloqueia elegibilidade de uso). */
  calendarEventPendingToday: boolean;
  balanceMinutes: number;
  excessMinutes: number;
  registrableMinutes: number;
  status: ResumoTableStatus;
  entryCount: number;
  eventLabel: string | null;
  balanceContribution: number;
  deficitContribution: number;
  faltaStatus: "efetiva" | "prevista" | null;
  absence: Absence | undefined;
  missingExpected: boolean;
}

export function resumoTableStatus(p: {
  date: string;
  today: string;
  realized: boolean;
  missingExpected: boolean;
  faltaStatus: "efetiva" | "prevista" | null;
  view: ReturnType<typeof companyDayContext>;
}): ResumoTableStatus {
  const { date, today, realized, missingExpected, faltaStatus, view } = p;
  const day = view.ctx.day;
  const absence = view.ctx.absence;
  const idleToday =
    date === today &&
    day.empty &&
    faltaStatus !== "efetiva" &&
    !absence &&
    view.effectiveExpected > 0;

  if (!realized) return day.entries.length > 0 ? "future" : "empty";
  if (idleToday) return "idle";
  if (missingExpected) return "empty";
  if (faltaStatus === "efetiva") return "falta";
  if (absence) return absence.kind === "ferias" ? "ferias" : "afastamento";
  if (day.entries.length > 0 && !day.consistent) return "inconsistent";
  if (date < today && day.financialPending && day.entries.length > 0) return "incomplete";
  if (day.open) return "in-progress";
  if (day.excessMinutes > 0) return "excess";
  // 4D.4 (Partes D/G/I): o evento EXPLÍCITO do calendário é fato suficiente.
  // Realizado o dia: folga/recesso integral com resultado negativo é déficit
  // factual (nunca "Sem registro"); ABONADO integral é dia ok (saldo 0).
  if (
    realized &&
    view.calendarEntry &&
    !day.open &&
    !day.financialPending &&
    view.abonadoIntegral
  ) return "ok";
  if (
    realized &&
    view.calendarEntry &&
    !day.open &&
    !day.financialPending &&
    view.requiredWorkMinutes > 0 &&
    view.regularBalance < 0
  ) return "deficit";
  if (isAbaixoDaBase({ date, today, view, missingExpected })) return "deficit";
  if (day.entries.length > 0) return "ok";
  return "empty";
}

export function buildResumoDayRow(p: {
  date: string;
  today: string;
  entries: TimeEntry[];
  absences: Absence[];
  calendars: CompanyCalendars | undefined;
  settings: WorkSettings;
  faltas: Falta[];
  controlStartDate?: string | null;
}): ResumoDayRow {
  const { date, today, entries, absences, calendars, settings, faltas, controlStartDate } = p;
  const cctx = companyDayContext(date, entries, absences, calendars, settings);
  const ctx = cctx.ctx;
  const absence = absenceOnDate(absences, date);
  const falta = faltaOnDate(faltas, date);
  const faltaStatus = falta ? faltaStatusOf(date, today) : null;
  const realized = isRealizedDate(date, today);
  const missingExpected = isMissingExpectedRecord(date, today, cctx, faltas, controlStartDate);
  const noFacts = ctx.day.entries.length === 0 && !falta && !absence;
  const status = resumoTableStatus({
    date,
    today,
    realized,
    missingExpected,
    faltaStatus,
    view: cctx,
  });
  return {
    date,
    workedMinutes: realized ? ctx.day.workedMinutes : 0,
    requiredWorkMinutes: cctx.calendarEntry ? cctx.requiredWorkMinutes : cctx.expectedRegular,
    calendarEventDay: !!cctx.calendarEntry,
    calendarEventPendingToday: calendarEventPendingToday(cctx, date, today),
    expectedMinutes: cctx.expectedRegular,
    // 4D.4 (Parte G)/4D.4.2: evento do calendário em HOJE sem jornada
    // encerrada permanece previsão — o saldo exibido é 0, nunca −8h prematuro
    // (mesmo guard canônico da contribuição factual abaixo).
    balanceMinutes: realized && !calendarEventPendingToday(cctx, date, today) ? cctx.regularBalance : 0,
    excessMinutes: realized ? ctx.day.excessMinutes : 0,
    registrableMinutes: realized ? ctx.day.registrableMinutes : 0,
    status,
    entryCount: ctx.day.entries.length,
    eventLabel:
      cctx.label ??
      (absence ? absenceLabel(absence) : null) ??
      (faltaStatus === "efetiva" ? "Falta" : faltaStatus === "prevista" ? "Falta prevista" : null),
    balanceContribution: dayBalanceContribution(cctx, faltas, date, today),
    // 4D.4 (Parte G): evento do calendário em HOJE sem jornada encerrada
    // permanece previsão — déficit factual só quando o dia é fato.
    deficitContribution:
      missingExpected ||
      date > today ||
      faltaStatus === "prevista" ||
      noFacts ||
      calendarEventPendingToday(cctx, date, today)
        ? 0
        : companyDeficitContribution(cctx),
    faltaStatus,
    absence,
    missingExpected,
  };
}

export function isQuietResumoDay(d: ResumoDayRow): boolean {
  return d.entryCount > 0 || !!d.eventLabel || !isWeekend(d.date);
}

/** Rótulo da coluna Evento — mesma ordem da tabela do Resumo. */
export function resumoEventKind(d: ResumoDayRow): string {
  if (d.status === "inconsistent") return "Registro inconsistente";
  if (d.status === "incomplete") return "Registro incompleto";
  if (d.eventLabel) return d.eventLabel;
  if (d.status === "excess") return "Acima do limite [10+]";
  if (d.status === "deficit") return "Jornada abaixo do previsto";
  if (d.status === "idle") return "Jornada não iniciada";
  if (d.status === "future") return "Registro futuro";
  if (d.status === "in-progress") return "Em andamento";
  if (d.status === "ok") return "Ok";
  if (d.missingExpected) return "Sem registro";
  return "—";
}

/** Financeiro do dia não é definitivo — apresentar "—", nunca 0min artificial. */
export function resumoFinancialFrozen(d: ResumoDayRow): boolean {
  return (
    d.status === "inconsistent" ||
    d.status === "incomplete" ||
    d.status === "idle" ||
    d.status === "future" ||
    d.status === "empty"
  );
}
