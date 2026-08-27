// ─────────────────────────────────────────────────────────────
// FONTE CENTRAL de obrigações COMPENSAR.
//
// Cobre, com a MESMA matemática:
//  - Afastamento acordado — compensar posteriormente
//  - Folga a compensar (calendário)
//  - Recesso a compensar
//  - demais ocorrências de calendário com tratamento COMPENSAR
//
// originalMinutes é IMUTÁVEL. Trabalho no próprio dia reduz a obrigação
// efetiva; só o que ultrapassar o original vira crédito. Planejado NÃO
// reduz openMinutes nem o saldo realizado.
// ─────────────────────────────────────────────────────────────
import { absenceJustifiedMinutes, type Absence } from "./absences";
import { entryOnDate, type CompanyCalendars } from "./company-calendar";
import { computeDay, formatDateBR, formatMinutes, isWeekend } from "./time";
import type { CompKind, Compensation, TimeEntry, WorkSettings } from "./types";

function kindOf(c: Compensation): CompKind {
  return c.kind ?? "excedente";
}
function concludedForSource(comps: Compensation[], date: string, kind: CompKind): number {
  return comps
    .filter((c) => c.sourceDate === date && kindOf(c) === kind && c.status === "concluida")
    .reduce((s, c) => s + c.minutes, 0);
}
function pendingForSource(comps: Compensation[], date: string, kind: CompKind): number {
  return comps
    .filter((c) => c.sourceDate === date && kindOf(c) === kind && c.status === "pendente")
    .reduce((s, c) => s + c.minutes, 0);
}

export type CompensarOriginKind = "agreement" | "company_calendar" | "recess";

export interface CompensarObligationView {
  originDate: string;
  originKind: CompensarOriginKind;
  /** Kind persistido nas compensações vinculadas. */
  compKind: CompKind;
  originLabel: string;
  /** IMUTÁVEL — carga original da obrigação. */
  originalMinutes: number;
  workedOnOriginDateMinutes: number;
  workedAppliedToObligation: number;
  effectiveObligationMinutes: number;
  completedMinutes: number;
  /** Planejado ativo limitado ao que ainda está em aberto. */
  activePlannedMinutes: number;
  /** Planejado bruto (pode exceder o aberto — sinal de sobreposição). */
  plannedMinutes: number;
  openMinutes: number;
  unplannedMinutes: number;
  /** openMinutes se originDate < today; senão 0. */
  realizedDebtMinutes: number;
  /** Trabalho que ultrapassou o original (ainda sujeito ao teto de 10h). */
  surplusMinutes: number;
  regularCreditMinutes: number;
  excessSpecialMinutes: number;
}

export const COMPENSAR_EXPLAIN =
  "As horas registradas neste dia reduzem primeiro a obrigação do próprio dia. Somente o que ultrapassar a obrigação original pode gerar saldo positivo.";

export function compensarOriginLabel(kind: CompensarOriginKind): string {
  if (kind === "agreement") return "Acordo a compensar";
  if (kind === "recess") return "Recesso a compensar — Calendário";
  return "Folga a compensar — Calendário";
}

export function specialPortionLabel(portion?: "regular" | "especial"): string {
  return portion === "especial"
    ? "EXCEDENTE DO LIMITE DIÁRIO [10+]"
    : "hora extra regular";
}

export function quitacaoLine(c: Compensation): string {
  return `${formatMinutes(c.minutes)} de ${specialPortionLabel(c.portion)} em ${formatDateBR(c.targetDate)}`;
}

function ofView(opts: {
  originDate: string;
  originKind: CompensarOriginKind;
  originalMinutes: number;
  worked: number;
  completed: number;
  planned: number;
  today: string;
  maxDailyMinutes: number;
}): CompensarObligationView {
  const originalMinutes = Math.max(0, opts.originalMinutes);
  const workedOnOriginDateMinutes = Math.max(0, opts.worked);
  const workedAppliedToObligation = Math.min(workedOnOriginDateMinutes, originalMinutes);
  const effectiveObligationMinutes = Math.max(0, originalMinutes - workedAppliedToObligation);
  const completedMinutes = Math.max(0, opts.completed);
  const plannedMinutes = Math.max(0, opts.planned);
  const openMinutes = Math.max(0, effectiveObligationMinutes - completedMinutes);
  const activePlannedMinutes = Math.min(plannedMinutes, openMinutes);
  const unplannedMinutes = Math.max(0, openMinutes - activePlannedMinutes);
  const surplusMinutes = Math.max(0, workedOnOriginDateMinutes - originalMinutes);
  const headroomToCap = Math.max(0, opts.maxDailyMinutes - originalMinutes);
  const regularCreditMinutes = Math.min(surplusMinutes, headroomToCap);
  const excessSpecialMinutes = Math.max(0, workedOnOriginDateMinutes - opts.maxDailyMinutes);
  const realizedDebtMinutes = opts.originDate < opts.today ? openMinutes : 0;
  return {
    originDate: opts.originDate,
    originKind: opts.originKind,
    compKind: opts.originKind === "agreement" ? "acordo" : "calendario",
    originLabel: compensarOriginLabel(opts.originKind),
    originalMinutes,
    workedOnOriginDateMinutes,
    workedAppliedToObligation,
    effectiveObligationMinutes,
    completedMinutes,
    activePlannedMinutes,
    plannedMinutes,
    openMinutes,
    unplannedMinutes,
    realizedDebtMinutes,
    surplusMinutes,
    regularCreditMinutes,
    excessSpecialMinutes,
  };
}

/** Obrigação COMPENSAR da data, se houver (acordo ou calendário). */
export function compensarObligationOnDate(
  date: string,
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  settings: WorkSettings,
  today: string,
): CompensarObligationView | undefined {
  const worked = computeDay(
    entries.filter((e) => e.date === date),
    settings,
  ).workedMinutes;
  const cal = entryOnDate(calendars, date);
  if (cal?.tratamento === "COMPENSAR") {
    const originKind: CompensarOriginKind =
      cal.categoria === "Recesso Final de Ano" ? "recess" : "company_calendar";
    return ofView({
      originDate: date,
      originKind,
      originalMinutes: Math.max(0, cal.horasACompensar * 60),
      worked,
      completed: concludedForSource(comps, date, "calendario"),
      planned: pendingForSource(comps, date, "calendario"),
      today,
      maxDailyMinutes: settings.maxDailyMinutes,
    });
  }
  const absence = absences.find(
    (a) => a.kind === "acordado" && a.treatment === "compensar" && date >= a.startDate && date <= a.endDate,
  );
  if (absence) {
    return ofView({
      originDate: date,
      originKind: "agreement",
      originalMinutes: absenceJustifiedMinutes(absence, settings),
      worked,
      completed: concludedForSource(comps, date, "acordo"),
      planned: pendingForSource(comps, date, "acordo"),
      today,
      maxDailyMinutes: settings.maxDailyMinutes,
    });
  }
  return undefined;
}

/** Todas as obrigações COMPENSAR de um intervalo (inclui futuras e quitadas). */
export function compensarObligationsInRange(
  entries: TimeEntry[],
  comps: Compensation[],
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
  settings: WorkSettings,
  range: { from: string; to: string },
  today: string,
): CompensarObligationView[] {
  const dates = new Set<string>();
  for (const a of absences) {
    if (a.kind !== "acordado" || a.treatment !== "compensar") continue;
    let cur = a.startDate;
    while (cur <= a.endDate) {
      if (cur >= range.from && cur <= range.to) dates.add(cur);
      cur = nextDay(cur);
    }
  }
  for (const cal of calendars ?? []) {
    for (const e of cal.entries) {
      if (e.tratamento !== "COMPENSAR") continue;
      if (e.date >= range.from && e.date <= range.to) dates.add(e.date);
    }
  }
  return [...dates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) =>
      compensarObligationOnDate(date, entries, comps, absences, calendars, settings, today),
    )
    .filter((v): v is CompensarObligationView => !!v);
}

function nextDay(d: string): string {
  const dt = new Date(`${d}T12:00:00`);
  dt.setDate(dt.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/**
 * Contribuição da obrigação ao SALDO REALIZADO:
 *  - futura ou hoje → 0 (ainda não é dívida realizada; trabalho no próprio
 *    dia também não vira crédito até ultrapassar o original — o surplus
 *    entra via dayCreditView/companyBalanceContribution);
 *  - passada → −openMinutes (a obrigação em aberto é fato realizado).
 *
 * O surplus (trabalho > original) NÃO entra aqui: já é crédito do dia.
 */
export function compensarRealizedDebtContribution(v: CompensarObligationView, today: string): number {
  if (v.originDate >= today) return 0;
  return -v.openMinutes;
}

export function isAbonadoDay(
  date: string,
  absences: Absence[],
  calendars: CompanyCalendars | undefined,
): { abonado: boolean; label: string | null } {
  const cal = entryOnDate(calendars, date);
  if (cal?.tratamento === "ABONADO") {
    return { abonado: true, label: cal.descricao ? `Abono — ${cal.descricao}` : "Dia abonado" };
  }
  const absence = absences.find((a) => date >= a.startDate && date <= a.endDate);
  if (!absence) return { abonado: false, label: null };
  if (absence.kind === "abono") return { abonado: true, label: "Abono de aniversário" };
  if (absence.kind === "acordado" && absence.treatment === "compensar") {
    return { abonado: false, label: null };
  }
  if (absence.kind === "acordado" && absence.treatment === "dispensado") {
    return { abonado: true, label: "Afastamento acordado — horas dispensadas" };
  }
  if (absence.kind === "ferias") return { abonado: true, label: "Férias" };
  if (absence.kind === "saude") return { abonado: true, label: "Afastamento por saúde" };
  if (absence.kind === "outro") return { abonado: true, label: "Outro afastamento justificado" };
  return { abonado: false, label: null };
}

export function weekendWithoutObligation(date: string, calendars: CompanyCalendars | undefined): boolean {
  if (!isWeekend(date)) return false;
  const cal = entryOnDate(calendars, date);
  return !cal || cal.tratamento !== "COMPENSAR";
}

/** Dia passado com entrada sem saída — nunca "em andamento". */
export function isIncompletePastPunch(date: string, open: boolean, today: string): boolean {
  return open && date < today;
}

/**
 * Libera parcelas PENDENTES de qualquer kind COMPENSAR/déficit para que o
 * planejado ativo não ultrapasse `remainingNeeded` (obrigação efetiva − concluído).
 */
export function releaseOverlappingPlannedForKind(
  comps: Compensation[],
  sourceDate: string,
  kind: CompKind,
  remainingNeeded: number,
): { comps: Compensation[]; released: number } {
  const pending = comps
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.sourceDate === sourceDate && kindOf(c) === kind && c.status === "pendente")
    .sort((a, b) => b.c.createdAt - a.c.createdAt || b.c.id - a.c.id);
  const totalPending = pending.reduce((s, p) => s + p.c.minutes, 0);
  let toRelease = Math.max(0, totalPending - Math.max(0, remainingNeeded));
  let released = 0;
  const next = [...comps];
  for (const { c, idx } of pending) {
    if (toRelease <= 0) break;
    if (c.minutes <= toRelease) {
      next[idx] = { ...c, status: "cancelada", note: appendNote(c.note, "Liberado: obrigação reduzida por trabalho no próprio dia") };
      released += c.minutes;
      toRelease -= c.minutes;
    } else {
      next[idx] = {
        ...c,
        minutes: c.minutes - toRelease,
        note: appendNote(c.note, "Liberado parcialmente: obrigação reduzida por trabalho no próprio dia"),
      };
      released += toRelease;
      toRelease = 0;
    }
  }
  return { comps: next, released };
}

/**
 * Reverte alocações CONCLUÍDAS mais recentes quando completed > efetiva.
 * Não apaga histórico: cancela/reduz e devolve os minutos à origem do crédito.
 */
export function releaseOverlappingCompletedForKind(
  comps: Compensation[],
  sourceDate: string,
  kind: CompKind,
  effectiveMinutes: number,
): { comps: Compensation[]; released: number } {
  const done = comps
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.sourceDate === sourceDate && kindOf(c) === kind && c.status === "concluida")
    .sort((a, b) => b.c.createdAt - a.c.createdAt || b.c.id - a.c.id);
  const total = done.reduce((s, p) => s + p.c.minutes, 0);
  let toRelease = Math.max(0, total - Math.max(0, effectiveMinutes));
  let released = 0;
  const next = [...comps];
  for (const { c, idx } of done) {
    if (toRelease <= 0) break;
    if (c.minutes <= toRelease) {
      next[idx] = { ...c, status: "cancelada", note: appendNote(c.note, "Revertido: obrigação reduzida por trabalho no próprio dia") };
      released += c.minutes;
      toRelease -= c.minutes;
    } else {
      next[idx] = {
        ...c,
        minutes: c.minutes - toRelease,
        note: appendNote(c.note, "Revertido parcialmente: obrigação reduzida por trabalho no próprio dia"),
      };
      released += toRelease;
      toRelease = 0;
    }
  }
  return { comps: next, released };
}

function appendNote(note: string | null, extra: string): string {
  if (!note) return extra;
  return note.includes(extra) ? note : `${note} · ${extra}`;
}

/** Reconcilia planejado e concluído de uma obrigação COMPENSAR após mutação de batidas. */
export function reconcileCompensarComps(
  comps: Compensation[],
  view: CompensarObligationView,
): Compensation[] {
  let next = comps;
  const afterDone = releaseOverlappingCompletedForKind(
    next, view.originDate, view.compKind, view.effectiveObligationMinutes,
  );
  next = afterDone.comps;
  const openAfter = Math.max(0, view.effectiveObligationMinutes - concludedForSource(next, view.originDate, view.compKind));
  const afterPlan = releaseOverlappingPlannedForKind(next, view.originDate, view.compKind, openAfter);
  return afterPlan.comps;
}
