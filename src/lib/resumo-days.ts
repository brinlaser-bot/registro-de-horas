// Classificação da tabela do Resumo — reutiliza Sem registro, isAbaixoDaBase
// e a resolução central. NÃO inventa saldo/déficit a partir de dia sem fatos.
import { absenceLabel, absenceOnDate, type Absence } from "./absences";
import { companyDayContext, companyDeficitContribution, type CompanyCalendars } from "./company-calendar";
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
    expectedMinutes: cctx.expectedRegular,
    balanceMinutes: realized ? cctx.regularBalance : 0,
    excessMinutes: realized ? ctx.day.excessMinutes : 0,
    registrableMinutes: realized ? ctx.day.registrableMinutes : 0,
    status,
    entryCount: ctx.day.entries.length,
    eventLabel:
      cctx.label ??
      (absence ? absenceLabel(absence) : null) ??
      (faltaStatus === "efetiva" ? "Falta" : faltaStatus === "prevista" ? "Falta prevista" : null),
    balanceContribution: dayBalanceContribution(cctx, faltas, date, today),
    deficitContribution:
      missingExpected || date > today || faltaStatus === "prevista" || noFacts
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
